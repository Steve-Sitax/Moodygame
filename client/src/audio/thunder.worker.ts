import { buildThunder } from "./thunderSynth";

// Builds thunder claps off the main thread (audio/aliveSounds.ts thunderPrime): a clap is 20 to 60 ms of sums.
self.onmessage = (e: MessageEvent<{ km: number; sr: number }>) => {
  const { km, sr } = e.data;
  const data = buildThunder(km, sr);
  (self as unknown as Worker).postMessage({ km, sr, data }, [data.buffer]);
};
