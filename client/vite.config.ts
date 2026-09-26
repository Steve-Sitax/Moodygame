import { defineConfig } from "vite";

// The game server (server/) listens on 127.0.0.1:8787. Vite forwards to it,
// so the browser only ever talks to one origin.
// A second working copy (a git worktree, e.g. for M4) runs on other ports: SCHELDEMIST_PORT
// for the game server, SCHELDEMIST_CLIENT_PORT for this dev server (npm run dev:alt).
const serverPort = Number(process.env.SCHELDEMIST_PORT) || 8787;
const clientPort = Number(process.env.SCHELDEMIST_CLIENT_PORT) || 5173;

export default defineConfig({
  server: {
    port: clientPort,
    strictPort: true,
    open: false,
    // shared/spots.json lives one level up, next to server/
    fs: { allow: [".."] },
    proxy: {
      "/api": `http://127.0.0.1:${serverPort}`,
      "/ws": { target: `ws://127.0.0.1:${serverPort}`, ws: true },
      "/mp": { target: `ws://127.0.0.1:${serverPort}`, ws: true }, // M8a multiplayer: the movement socket
    },
  },
});
