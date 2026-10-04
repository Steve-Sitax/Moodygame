// Check the frame budget and sample conversion, and retain literal before/after measurements.
// Usage: node tools/godot/check-soundtest.mjs <new soundtest.json> <earlier soundtest.json>
import fs from "node:fs";
import path from "node:path";

const [currentFile, earlierFile] = process.argv.slice(2);
if (!currentFile || !earlierFile) throw new Error("Give the current and earlier soundtest.json paths");
const current = JSON.parse(fs.readFileSync(currentFile, "utf8"));
const earlier = JSON.parse(fs.readFileSync(earlierFile, "utf8"));
const problems = [...current.problems];
if (current.cost.framesOverBudget !== 0 || current.cost.maxMs > 0.3)
  problems.push("Sound frames exceeded 0.3 ms; see cost.overBudget");
if (current.loaded.failed.length) problems.push("Some recordings failed to load");
const decoded = current.loaded.decodedLevels ?? [];
if (!decoded.length) problems.push("Missing decoded recording level checks");
for (const x of decoded) {
  // One displayed rounding unit is allowed at a rounding boundary; actual error must remain below 0.001 dB.
  if (Math.abs(x.sourcePeakDb - x.pcmPeakDb) > 0.100001 || Math.abs(x.sourceRmsDb - x.pcmRmsDb) > 0.100001
      || Math.abs(x.peakDifferenceDb) > 0.001 || Math.abs(x.rmsDifferenceDb) > 0.001)
    problems.push(`Recording level changed: ${x.file}`);
}
const old = new Map(earlier.sounds.map(x => [x.name, x]));
const fields = ["peak_db", "rms_db", "gain", "browser_gain", "expected_peak_db"];
const rows = current.sounds.map(x => {
  const before = old.get(x.name);
  if (!before) { problems.push(`New measurement without a baseline: ${x.name}`); return { name: x.name }; }
  if (JSON.stringify(before.browser_gain) !== JSON.stringify(x.browser_gain))
    problems.push(`Configured gain changed: ${x.name}`);
  return { name: x.name, ...Object.fromEntries(fields.map(k => [k, {
    earlier: before[k] ?? null, after: x[k] ?? null,
    matchesEarlier: JSON.stringify(before[k]) === JSON.stringify(x[k]),
  }])) };
});
if (current.sounds.length !== earlier.sounds.length) problems.push("Sound row count changed");
for (const layer of current.layers) {
  const before = earlier.layers.find(x => x.name === layer.name);
  if (!before || JSON.stringify(before.browserGains) !== JSON.stringify(layer.browserGains))
    problems.push(`Configured layer gain changed: ${layer.name}`);
}
const report = {
  note: "The earlier test was unseeded. Row differences are literal measurements, not an equality claim; decoded recording levels and configured gains are checked independently.",
  cost: current.cost,
  pcm: { recordings: decoded.length, maxPeakDifferenceDb: Math.max(...decoded.map(x => Math.abs(x.peakDifferenceDb))),
    maxRmsDifferenceDb: Math.max(...decoded.map(x => Math.abs(x.rmsDifferenceDb))),
    roundingBoundaryRows: decoded.filter(x => x.sourcePeakDb !== x.pcmPeakDb || x.sourceRmsDb !== x.pcmRmsDb).map(x => x.file) },
  differentRows: Object.fromEntries(fields.map(k => [k, rows.filter(x => x[k]?.matchesEarlier === false).length])),
  problems, rows,
};
const out = path.join(path.dirname(currentFile), "comparison.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ cost: current.cost, pcm: report.pcm, differentRows: report.differentRows, problems, report: out }, null, 2));
process.exitCode = problems.length ? 1 : 0;
