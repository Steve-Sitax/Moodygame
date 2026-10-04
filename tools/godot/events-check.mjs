// The event port's isolated, bounded console run. No existing save is opened or copied.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const out = path.resolve(arg('out', path.join(root, 'godot/baked/eventtest')));
fs.mkdirSync(out, { recursive: true });
const exe = arg('godot', 'C:/Users/steve/AppData/Local/Microsoft/WinGet/Packages/GodotEngine.GodotEngine.Mono_Microsoft.Winget.Source_8wekyb3d8bbwe/Godot_v4.7.2-stable_mono_win64/Godot_v4.7.2-stable_mono_win64_console.exe');
const lock = 'D:/Code/MoodyGame-godot/godot/baked/PERF-LOCK';
const guard = async () => { while (fs.existsSync(lock)) { console.log('Waiting for PERF-LOCK (60 seconds).'); await new Promise(r => setTimeout(r, 60000)); } };
const run = (argv, name, seconds, environment = {}) => new Promise(resolve => {
  const child = spawn(exe, argv, { cwd: root, windowsHide: true, env: { ...process.env, ...environment } });
  let text = '';
  const output = fs.createWriteStream(path.join(out, name + '.log'));
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output.write(chunk); text += chunk.toString(); });
  const timer = setTimeout(() => {
    console.error(name + ' timed out');
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch {} }
    else child.kill('SIGKILL');
  }, seconds * 1000);
  child.on('error', e => { console.error(e.message); clearTimeout(timer); output.end(); resolve(1); });
  child.on('close', code => { clearTimeout(timer); output.end(); console.log(name + ': exit ' + code); resolve(code === 0 && !/ERROR:|ObjectDisposedException/.test(text) ? 0 : 1); });
});
await guard();
if (!args.includes('--no-import') && await run(['--headless', '--path', 'godot', '--import', '--quit'], 'import', 90)) process.exit(1);
await guard();
const db = path.join(out, 'test.sqlite');
if (fs.existsSync(db)) throw new Error('The test database already exists: choose a fresh output directory.');
const options = ['--path', 'godot', '--', '--town', arg('town', 'D:/Code/MoodyGame-godot/godot/baked/next/town.glb'), '--models', arg('models', 'D:/Code/MoodyGame-godot/godot/baked/models'), '--no-ai', '--no-mainmenu', '--port', arg('port', '8920'), '--db', db, '--prefs', path.join(out, 'settings.json'), '--eventtest', out];
if (arg('only', '')) options.push('--eventonly', arg('only', ''));
let code;
try { code = await run(options, 'eventtest', Number(arg('timeout', '600')), { SCHELDEMIST_USER_DATA: path.join(out, 'user'), SCHELDEMIST_MAP_PORT: arg('map-port', '8929') }); }
finally { for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(db + suffix, { force: true }); }
process.exitCode = code;
