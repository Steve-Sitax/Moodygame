// M8e (docs/milestones/M8e.md): the secure address and "Get the house certificate", as the join card
// (boot/netboot.ts) and the Together panel (net/mp/together.ts) show them. Plain English, short.

import { identity, TOKEN_HEADER } from "./identity";

/** What the server says about the house's https (GET /api/mp/info `house`; all public). */
export interface HouseInfo {
  /** The secure address for the name this page came by (null: that name is not on the certificate). */
  https: string | null;
  /** The house certificate's path (/house-ca.crt). */
  ca: string;
  /** SHA-256 fingerprint of the house certificate (AA:BB:...). */
  sha256: string;
  /** SHA-1 fingerprint: Windows shows this one as "Thumbprint". */
  sha1: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Only an https address of this game is ever made a link. */
const safeUrl = (u: string) => (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(u) ? u : null);

/** The steps to trust the house certificate, once per device. */
export function trustSteps(h: HouseInfo): string {
  return `<details class="mp-house-help" style="margin-top:4px"><summary>How to trust it (once per device)</summary>
    <ol style="margin:4px 0 0 1.2em;padding:0">
      <li><a href="${esc(h.ca)}" download="scheldemist-house.crt">Get the house certificate</a>.</li>
      <li><b>Windows</b> (Chrome, Edge): open the file, Install Certificate, Current User, "Place all certificates in the following store", Browse, "Trusted Root Certification Authorities", Next, Finish, Yes.</li>
      <li><b>Firefox</b>: Settings, Privacy &amp; Security, View Certificates, Authorities, Import, tick "Trust this CA to identify websites".</li>
      <li><b>Android</b>: Settings, Security, Encryption &amp; credentials, Install a certificate, CA certificate, pick the file.</li>
      <li><b>iPhone, iPad</b>: open the file in Safari, Allow. Settings, Profile Downloaded, Install. Then Settings, General, About, Certificate Trust Settings: turn it on.</li>
      <li>Check before you trust it: the fingerprint must be the one on the host's screen.<br><span style="font-size:0.85em;word-break:break-all">SHA-256 <code>${esc(h.sha256)}</code><br>SHA-1 (Windows: "Thumbprint") <code>${esc(h.sha1)}</code></span></li>
    </ol></details>`;
}

/** The join card's note on an http page: the secure address, and how to trust the house. */
export function secureOffer(h: HouseInfo | null | undefined): string {
  if (!h || location.protocol === "https:") return "";
  const url = h.https ? safeUrl(h.https) : null;
  if (!url) return "";
  // (M8e review 4: a guest in the game takes his man along: the click asks for a move code, see below)
  const after = identity.token
    ? "Trust the house certificate first; your man comes with you (the link is made when you click it and works once), and the game is copied once more."
    : "Trust the house certificate first; there you join once more and the game is copied once more.";
  return `<div class="now mp-house" style="margin-top:10px;font-size:0.9em">
    <b>Safer:</b> <a class="mp-safer" href="${esc(url)}">${esc(url)}</a>. ${after}
    <span class="mp-safer-out" style="font-style:italic"></span>
    ${trustSteps(h)}</div>`;
}

// ------------------------------------------------------------------ M8e review 4: moving to the secure address

// (the browser's own fetch and timer, taken before boot/netboot.ts and game/pause.ts hook them: a click in a
// paused menu must not wait for the unpause)
const rawFetch = typeof window !== "undefined" ? window.fetch.bind(window) : null;
const rawTimeout = typeof window !== "undefined" ? window.setTimeout.bind(window) : null;
const rawClear = typeof window !== "undefined" ? window.clearTimeout.bind(window) : null;

/**
 * The secure address with a one-time move code (POST /api/mp/transfer: 60 s, single use) in its #fragment: the
 * new page (boot/netboot.ts) redeems it for a token of the same player. The fragment never goes to a server.
 */
export async function moveUrl(base: string): Promise<string> {
  if (!rawFetch || !rawTimeout || !identity.token) throw new Error("Join the game first.");
  const ctl = new AbortController();
  const t = rawTimeout(() => ctl.abort(), 8000);
  try {
    const r = await rawFetch("/api/mp/transfer", { method: "POST", headers: { [TOKEN_HEADER]: identity.token }, signal: ctl.signal });
    const d = (await r.json().catch(() => ({}))) as { code?: unknown; error?: unknown };
    if (!r.ok || typeof d.code !== "string" || !/^[0-9a-f]{32}$/.test(d.code)) throw new Error(typeof d.error === "string" ? d.error : `The host did not answer (${r.status}).`);
    const u = new URL(base);
    if (identity.seat >= 2) u.searchParams.set("seat", String(identity.seat));
    u.hash = `move=${d.code}`;
    return u.href;
  } finally {
    rawClear?.(t);
  }
}

// A click on the secure address by a guest in the game: the link with his move code; without a token (the join
// card before joining) the plain link. (One listener for the join card and the Together panel.) A middle click or a
// copied link is the plain address: there he joins again.
if (typeof document !== "undefined")
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a.mp-safer") as HTMLAnchorElement | null;
    if (!a || !identity.token || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    const out = a.parentElement?.querySelector<HTMLElement>(".mp-safer-out");
    if (out) out.textContent = "Taking your man along...";
    moveUrl(a.href).then(
      (href) => location.assign(href),
      (err: unknown) => {
        if (out) out.textContent = err instanceof Error && err.message ? err.message : "The host's PC does not answer. Try again.";
      },
    );
  }, true); // (the capture phase: the Together panel stops its clicks from bubbling)
