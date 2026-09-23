// The push channel as the director's modules see it (set by routes.ts; a no-op in tests).
export const bus = {
  broadcast: (_msg: unknown): void => {},
};

export function notify(type: "actions" | "events" | "convo", extra: Record<string, unknown> = {}): void {
  bus.broadcast({ type, ...extra });
}
