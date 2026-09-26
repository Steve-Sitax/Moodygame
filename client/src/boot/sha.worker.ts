// M8a: the asset loader's hash check off the main thread (boot/netboot.ts): a file in, its SHA-256 out.
import { sha256Hex } from "./sha256";

self.onmessage = (e: MessageEvent<{ id: number; buf: ArrayBuffer }>) => {
  const { id, buf } = e.data;
  (self as unknown as Worker).postMessage({ id, sha: sha256Hex(new Uint8Array(buf)) });
};
