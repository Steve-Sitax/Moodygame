import { defineConfig } from "vite";

// The game server (server/) listens on 127.0.0.1:8787. Vite forwards to it,
// so the browser only ever talks to one origin.
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    open: false,
    // shared/spots.json lives one level up, next to server/
    fs: { allow: [".."] },
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
});
