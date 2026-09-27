// M8e (docs/milestones/M8e.md): the secure address and "Get the house certificate", as the join card
// (boot/netboot.ts) and the Together panel (net/mp/together.ts) show them. Plain English, short.

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
  return `<div class="now mp-house" style="margin-top:10px;font-size:0.9em">
    <b>Safer:</b> <a href="${esc(url)}">${esc(url)}</a>. Trust the house certificate first; there you join once more and the game is copied once more.
    ${trustSteps(h)}</div>`;
}
