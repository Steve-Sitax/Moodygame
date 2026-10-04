// Build the existing Node server for a Godot download. No TypeScript compiler runs on the player's PC.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function run(command, args, cwd = root) {
  const shell = process.platform === 'win32' && command.endsWith('.cmd');
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell, timeout: 600_000 });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} failed (${result.status})`);
}
export function buildServer(out) {
  out = path.resolve(out);
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24: the bundled runtime and native modules must match.');
  const build = path.join(root, 'godot/dist/server-build');
  fs.rmSync(build, { recursive: true, force: true });
  run(process.execPath, [path.join(root, 'server/node_modules/typescript/bin/tsc'), '-p', 'tools/godot/server.tsconfig.json']);
  const copy = (from, to = from) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });
  fs.cpSync(path.join(build, 'server/src'), path.join(out, 'server/src'), { recursive: true });
  fs.cpSync(path.join(build, 'shared'), path.join(out, 'shared'), { recursive: true });
  // Runtime JSON read both by imports and by filename, without source files or tests.
  fs.cpSync(path.join(root, 'shared'), path.join(out, 'shared'), { recursive: true, filter: p => fs.statSync(p).isDirectory() || p.endsWith('.json') });
  for (const dir of ['city', 'audio', 'textures']) copy(`client/public/${dir}`);
  for (const file of ['park.json', 'wall.glb']) copy(`client/public/models/${file}`);
  copy('server/package.json');
  copy('server/package-lock.json');
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], path.join(out, 'server'));
  const sdk = path.join(out, 'server/node_modules/@anthropic-ai');
  for (const name of fs.existsSync(sdk) ? fs.readdirSync(sdk) : []) {
    if (name.startsWith('claude-agent-sdk-')) fs.rmSync(path.join(sdk, name), { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(out, 'runtime'), { recursive: true });
  const node = path.join(out, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  fs.copyFileSync(process.execPath, node);
  fs.chmodSync(node, 0o755);
  fs.writeFileSync(path.join(out, 'runtime/VERSION.txt'), `Node.js ${process.version}, ${process.platform}/${process.arch}, MIT licence (https://nodejs.org)\n`);
  // Verify the installed native SQLite module using the exact runtime that goes in the download.
  run(node, ['--input-type=module', '-e', "import Database from 'better-sqlite3'; const db = new Database(':memory:'); db.prepare('select 1').get(); db.close();"], path.join(out, 'server'));
}
