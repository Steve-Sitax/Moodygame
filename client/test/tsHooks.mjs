// For the client tests that load the game's own TypeScript in node (node strips the types): an import without
// an extension ("../../shared/mpProtocol") gets ".ts", as vite resolves it. Import this first, then the game's
// modules with a dynamic import().
import { register } from 'node:module';

async function resolve(s, c, next) {
  try {
    return await next(s, c);
  } catch (e) {
    const rel = s.startsWith('./') || s.startsWith('../');
    if (rel && !/[.][a-z]+$/.test(s)) return next(s + '.ts', c);
    // ("x.js" for a file that is "x.ts": how the server's tests read the shared plans)
    if (rel && s.endsWith('.js')) return next(s.slice(0, -3) + '.ts', c);
    throw e;
  }
}
register('data:text/javascript,' + encodeURIComponent('export ' + resolve.toString()));
