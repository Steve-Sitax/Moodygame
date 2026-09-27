// M8a multiplayer: the movement socket (/mp) on this side (docs/multiplayer-plan.md 4.3).
// - hello with the token (or none: the host), then own state 20 times a second, always, also while the menu
//   is up (he stands there, "away"): the server's clock runs while anyone is in the game;
// - a ping every second: the offset to the server's clock (the best of the last 8 round trips), so every PC
//   draws the others on the same timeline;
// - the others' batches go to the Remotes; the roster (names, looks, away) to whoever listens.
// Nothing that comes back ever moves this player or his camera.
// M8e (net/mp/link.ts): a lost line comes back by itself with the same token (1, 2, 4 ... 15 s), a dead one is
// found by the pings, and the player sees a small note instead of an error.

import { real } from "../../game/pause";
import { decodeBatch, encodeState, MP_PROTOCOL, MSG_ANIMALS, MSG_FIGS, MSG_PUPPETS, SEND_MS, type MpState, type MpText, type RosterEntry } from "../../../../shared/mpProtocol";
import { identity } from "./identity";
import { CONNECT_MS, Liveness, noteText, retryDelay, showNote } from "./link";

export interface SessionHooks {
  /** Own state now with the time it was true (server clock), or null (not in the game yet). */
  sample(serverNow: number): Omit<MpState, "seq"> | null;
  onBatch(list: Array<{ id: number; s: MpState }>, serverNow: number, recvServerNow: number): void;
  /** M8b: a batch of townspeople from their owner (net/mp/street.ts reads it). */
  onPuppets?(v: DataView, recvServerNow: number): void;
  /** M8d: a batch of another player's job figures (net/mp/jobfigs.ts reads it). */
  onFigs?(v: DataView, recvServerNow: number): void;
  /** M8f sync pass 3: a batch of the animals another PC runs (net/mp/extras.ts reads it). */
  onAnimals?(v: DataView, recvServerNow: number): void;
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
  /** M8e: tries since the line was lost; when it was lost (0: up); whether this tab was ever in. */
  private attempt = 0;
  private lostAt = 0;
  private ever = false;
  private readonly live = new Liveness();
  private retryTimer = 0;
  private connectTimer = 0;
  private onlineHooked = false;
  closed = false;
  /** Bytes each way, frames sent (the harness reads these). */
  stats = { up: 0, down: 0, sent: 0, batches: 0, reconnects: 0, skipped: 0 };

  constructor(private readonly hooks: SessionHooks) {}

  /** The server's clock now (ms), as well as this side knows it. */
  serverNow(): number {
    return real.now() + this.offset;
  }

  open(): void {
    if (this.closed || this.ws) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    if (!this.onlineHooked) {
      // (the browser is on the network again, a VPN back up: try now rather than at the next wait)
      this.onlineHooked = true;
      window.addEventListener("online", () => {
        if (this.lostAt && !this.ws && !this.closed) this.open();
      });
    }
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/mp`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.live.reset();
    // a connect that hangs (a dead VPN) is given up and tried again
    clearTimeout(this.connectTimer);
    this.connectTimer = real.setTimeout(() => {
      if (this.ws === ws && ws.readyState !== WebSocket.OPEN) this.giveUp(ws);
    }, CONNECT_MS);
    ws.onopen = () => {
      clearTimeout(this.connectTimer);
      ws.send(JSON.stringify({ type: "hello", token: identity.token ?? undefined, seat: identity.seat, protocol: MP_PROTOCOL, version: identity.version } satisfies MpText));
      this.ping();
    };
    ws.onmessage = (e) => {
      this.live.heard();
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
          // (M8e: in again, on the same seat: the note says so for a moment)
          if (this.lostAt) showNote("Connected again.", true);
          this.attempt = 0;
          this.lostAt = 0;
          this.ever = true;
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
      if (buf.byteLength && new Uint8Array(buf, 0, 1)[0] === MSG_FIGS) {
        this.hooks.onFigs?.(new DataView(buf), this.serverNow());
        return;
      }
      if (buf.byteLength && new Uint8Array(buf, 0, 1)[0] === MSG_ANIMALS) {
        this.hooks.onAnimals?.(new DataView(buf), this.serverNow());
        return;
      }
      const b = decodeBatch(buf);
      if (!b) return;
      this.stats.batches++;
      this.hooks.onBatch(b.list, b.serverNow, this.serverNow());
    };
    ws.onclose = (e) => {
      // no hello, an old version, removed, not together, his own other tab took over, or (M8e) a flood: no going
      // back in
      if (e.code >= 4001 && e.code <= 4006) {
        this.closed = true;
        if (e.code === 4005) this.hooks.onText({ type: "refused", why: "You are playing in another tab of this browser now." });
      }
      this.lost(ws);
    };
    ws.onerror = () => {};
  }

  /** M8e: the line is gone (closed, or given up): try again after the next wait, with the note up. */
  private lost(ws: WebSocket): void {
    if (this.ws !== ws) return; // (an old socket, given up already)
    clearTimeout(this.connectTimer);
    this.stopSending();
    this.ws = null;
    if (this.closed) {
      showNote(null);
      return;
    }
    const now = real.now();
    if (!this.lostAt) this.lostAt = now;
    this.stats.reconnects++;
    showNote(noteText(now - this.lostAt, this.ever));
    this.retryTimer = real.setTimeout(() => this.open(), retryDelay(this.attempt++));
  }

  /** M8e: a socket that hangs (no answer to the pings, or a connect that does not come): dropped without a word. */
  private giveUp(ws: WebSocket): void {
    ws.onopen = ws.onmessage = ws.onclose = null;
    try {
      ws.close();
    } catch {
      /* already gone */
    }
    this.lost(ws);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.ws?.close();
    showNote(null);
  }

  private ping(): void {
    const ws = this.ws;
    if (ws?.readyState !== WebSocket.OPEN) return;
    const now = real.now();
    if (this.live.dead(now)) {
      this.giveUp(ws);
      return;
    }
    const m = JSON.stringify({ type: "ping", c: now } satisfies MpText);
    this.stats.up += m.length;
    ws.send(m);
    this.live.pinged(now);
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
