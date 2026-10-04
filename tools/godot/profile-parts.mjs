// Diagnostic source probes, confined to this checkout. Restore before committing game code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backup = path.join(root, 'godot/baked/perf2/profile-sources.json');
if (process.argv.includes('--remove')) {
  const files = JSON.parse(fs.readFileSync(backup, 'utf8'));
  for (const [file, original] of Object.entries(files)) {
    const target = path.join(root, file);
    // Remove only probe statements, preserving any implementation edits since profiling started.
    const text = fs.readFileSync(target, 'utf8').replace(/\n        using var perf2Probe = Scheldemist\.Dev\.FrameCost\.Track\("[^"]+"\);/g, '');
    const seen = {};
    fs.writeFileSync(target, text.replace(/(public override void (_Process|_PhysicsProcess)\(double (\w+)\))\s*\{\s*Perf2Body\2\(\3\);\s*\}\s*private void Perf2Body\2\(double \3\)\s*\{/g,
      (_, signature, method) => {
        const index = seen[method] ?? 0; seen[method] = index + 1;
        return [...original.matchAll(new RegExp(`public override void ${method}\\(double \\w+\\)\\s*\\{`, 'g'))][index][0];
      }));
  }
  fs.unlinkSync(backup);
} else {
  if (fs.existsSync(backup)) throw new Error('Probes already installed');
  const saved = {};
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.name.endsWith('.cs')) {
        const original = fs.readFileSync(file, 'utf8');
        const relative = path.relative(root, file).replaceAll('\\', '/');
        const methods = process.argv.includes('--ui')
          ? /(public override (?:void|Vector2) (_Process|_PhysicsProcess|_Draw|_Notification|_GetMinimumSize)\((?:double \w+|int \w+)?\)\s*\{)/g
          : /(public override void (_Process|_PhysicsProcess)\(double \w+\)\s*\{)/g;
        const text = original.replace(methods, (_, start, method) => {
          const probe = `\n        using var perf2Probe = Scheldemist.Dev.FrameCost.Track("${relative}:${method}");`;
          if (process.argv.includes('--entry') && (method === '_Process' || method === '_PhysicsProcess')) {
            const param = start.match(/\(double (\w+)\)/)[1];
            // An outer method includes compiler-hoisted display classes in the measurement.
            // A probe inside the original body starts after those allocations.
            return `${start}${probe}\n        Perf2Body${method}(${param});\n    }\n    private void Perf2Body${method}(double ${param})\n    {`;
          }
          return start + probe;
        });
        if (text !== original) { saved[relative] = original; fs.writeFileSync(file, text); }
      }
    }
  }
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  visit(path.join(root, 'godot/src'));
  fs.writeFileSync(backup, JSON.stringify(saved));
  console.log(`Installed process/physics probes in ${Object.keys(saved).length} source files`);
}
