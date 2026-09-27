// M8a multiplayer: the movement socket (/mp) on this side (docs/multiplayer-plan.md 4.3).
// - hello with the token (or none: the host), then own state 20 times a second, always, also while the menu
//   is up (he stands there, "away"): the server's clock runs while anyone is in the game;
// - a ping every second: the offset to the server's clock (the best of the last 8 round trips), so every PC
//   draws the others on the same timeline;
// - the others' batches go to the Remotes; the roster (names, looks, away) to whoever listens.
// Nothing that comes back ever moves this player or his camera.

import { real } from "../../game/pause";
import { decodeBatch, encodeState, MP_PROTOCOL, MSG_PUPPETS, SEND_MS, type MpState, type MpText, type RosterEntry } from "../../../../shared/mpProtocol";
import { identity } from "./identity";

export interface SessionHooks {
  /** Own state now with the time it was true (server clock), or null (not in the game yet). */
  sample(serverNow: number): Omit<MpState, "seq"> | null;
  onBatch(list: Array<{ id: number; s: MpState }>, serverNow: number, recvServerNow: number): void;
  /** M8b: a batch of townspeople from their owner (net/mp/street.ts reads it). */
  onPuppets?(v: DataView, recvServerNow: number): void;
  onRoster(list: RosterEntry[]): void;
  onWelcome(w: Extract<MpText, { type: "welcome" }>): void;
  onText(m: MpText): void;
}

export class Session {
  ws: WebSocket | null = null;
  id = 0;
  /** server time = real.now() + offset (ms) */
  offset = 0;
  private samples: Array<{ rtt: number; off: number }> = [];
  rtt = 0;
  private seq = 0;
  private sendTimer = 0;
  private pingTimer = 0;
  private retry = 1000;
  closed = false;
  /** Bytes each way, frames sent (the harness reads these). */
  stats = { up: 0, down: 0, sent: 0, batches: 0, reconnects: 0, skipped: 0 };

  constructor(private readonly hooks: SessionHooks) {}

  /** The server's clock now (ms), as well as this side knows it. */
  serverNow(): number {
    return real.now() + this.offset;
  }

  open(): void {
    if (this.closed) return;
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/mp`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 1000;
      ws.send(JSON.stringify({ type: "hello", token: identity.token ?? undefined, seat: identity.seat, protocol: MP_PROTOCOL, version: identity.version } satisfies MpText));
      this.ping();
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        this.stats.down += e.data.length;
        let m: MpText;
        try {
          m = JSON.parse(e.data) as MpText;
        } catch {
          return;
        }
        if (m.type === "pong") this.pong(m.c, m.s);
        else if (m.type === "welcome") {
          this.id = m.id;
          // a first guess of the offset until the pings speak
          if (!this.samples.length) this.offset = m.serverNow - real.now();
          this.hooks.onWelcome(m);
          this.startSending();
        } else if (m.type === "roster") this.hooks.onRoster(m.players);
        else {
          if (m.type === "old" || m.type === "kicked" || m.type === "refused") this.closed = true;
          this.hooks.onText(m);
        }
        return;
      }
      const buf = e.data as ArrayBuffer;
      this.stats.down += buf.byteLength;
      if (buf.byteLength && new Uint8Array(buf, 0, 1)[0] === MSG_PUPPETS) {
        this.hooks.onPuppets?.(new DataView(buf), this.serverNow());
        return;
      }
      const b = decodeBatch(buf);
      if (!b) return;
      this.stats.batches++;
      this.hooks.onBatch(b.list, b.serverNow, this.serverNow());
    };
    ws.onclose = (e) => {
      this.stopSending();
      this.ws = null;
      // no hello, an old version, removed, not together, or his own other tab took over: no going back in
      if (e.code >= 4001 && e.code <= 4005) {
        this.closed = true;
        if (e.code === 4005) this.hooks.onText({ type: "refused", why: "You are playing in another tab of this browser now." });
      }
      if (this.closed) return;
      this.stats.reconnects++;
      real.setTimeout(() => this.open(), this.retry);
      this.retry = Math.min(10_000, this.retry * 2);
    };
    ws.onerror = () => {};
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  private ping(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const m = JSON.stringify({ type: "ping", c: real.now() } satisfies MpText);
    this.stats.up += m.length;
    this.ws.send(m);
  }

  private pong(c: number, s: number): void {
    const now = real.now();
    const rtt = now - c;
    // the server read its clock about half way through the round trip
    this.samples.push({ rtt, off: s + rtt / 2 - now });
    if (this.samples.length > 8) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.off;
    this.rtt = best.rtt;
  }

  private startSending(): void {
    this.stopSending();
    // the untouched timers (game/pause.ts): together nothing pauses, and a paused tab (the loading screen, the host's
    // "pause all") still says where it stands
    this.sendTimer = real.setInterval(() => this.sendNow(), SEND_MS);
    this.pingTimer = real.setInterval(() => this.ping(), 1000);
  }

  private stopSending(): void {
    if (this.sendTimer) clearInterval(this.sendTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.sendTimer = this.pingTimer = 0;
  }

  /** M8b: a text message (claim, release, the world), if the socket is open. */
  sendText(m: MpText): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.id) return false;
    const s = JSON.stringify(m);
    this.stats.up += s.length;
    ws.send(s);
    return true;
  }

  /**
   * M8b: a binary frame (the townspeople this PC walks). A line that cannot keep up (over 64 KB waiting) skips
   * it: the next one replaces it (the research: never queue stale states).
   */
  sendBinary(b: ArrayBuffer): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.id) return false;
    if (ws.bufferedAmount > 64 * 1024) {
      this.stats.skipped++;
      return false;
    }
    this.stats.up += b.byteLength;
    ws.send(b);
    return true;
  }

  sendNow(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.id) return;
    const s = this.hooks.sample(this.serverNow());
    if (!s) return;
    const b = encodeState({ ...s, seq: ++this.seq });
    this.stats.up += b.byteLength;
    this.stats.sent++;
    ws.send(b);
  }
}
