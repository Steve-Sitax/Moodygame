// A sound never throws into the frame (fix 2026-09-26, "non-finite AudioParam value" at night).
//
// Every AudioParam in the game is set in one of a few hundred places (soundscape, event cues, the alive
// sounds, the organ, the ballads). The Web Audio API throws on a value or time that is not a finite
// number (NaN from a thing at no place, 0/0 in a gain), and on a few other bad calls (a negative time,
// an exponential ramp to 0). One throw from a sound called inside a world part's update (the rail
// clack, a crane at work) stopped that part's frame, and the kit's perf() and step().
//
// So the setters go through here, installed once when the Soundscape is made: a bad value is skipped,
// not thrown; counted; and in dev logged once per method and message with where it came from. The
// causes are fixed where they come from (the listener, the positions); this is the net under them.

/** How many AudioParam calls were skipped, and the last (dev checks: Soundscape.graph().paramSkips). */
export const paramSkips = { n: 0, last: "" };

const logged = new Set<string>();
let installed = false;

function skipped(what: string): void {
  paramSkips.n++;
  paramSkips.last = what;
  if (logged.has(what) || logged.size > 50) return;
  logged.add(what);
  if (import.meta.env?.DEV) console.warn(`[sound] skipped a bad AudioParam call: ${what}`, new Error().stack);
}

const METHODS = ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "setTargetAtTime", "setValueCurveAtTime", "cancelScheduledValues", "cancelAndHoldAtTime"];

/** Wrap AudioParam's setters (once): a non-finite number or a call the browser refuses is skipped. */
export function installSafeParams(): void {
  if (installed || typeof AudioParam === "undefined") return;
  installed = true;
  const P = AudioParam.prototype as unknown as Record<string, unknown>;
  for (const m of METHODS) {
    const orig = P[m];
    if (typeof orig !== "function") continue;
    P[m] = function (this: AudioParam, ...a: unknown[]): AudioParam {
      for (const v of a) {
        if (typeof v === "number" && !Number.isFinite(v)) {
          // (logged once per method and shape: "setValueAtTime(NaN, t)", not once per time)
          skipped(`${m}(${a.map((x) => (typeof x !== "number" ? typeof x : Number.isFinite(x) ? "n" : String(x))).join(", ")})`);
          return this;
        }
      }
      try {
        return (orig as (...b: unknown[]) => AudioParam).apply(this, a);
      } catch (e) {
        skipped(`${m}: ${(e as Error)?.message ?? e}`);
        return this;
      }
    };
  }
  const d = Object.getOwnPropertyDescriptor(AudioParam.prototype, "value");
  if (d?.get && d.set) {
    const set = d.set;
    Object.defineProperty(AudioParam.prototype, "value", {
      configurable: true,
      enumerable: d.enumerable,
      get: d.get,
      set(this: AudioParam, v: number) {
        if (!Number.isFinite(v)) {
          skipped(`value = ${v}`);
          return;
        }
        set.call(this, v);
      },
    });
  }
}
