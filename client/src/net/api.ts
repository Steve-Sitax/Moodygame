// Client side of the game server. The server owns all numbers;
// the client shows them and reports what happened in 3D.

export interface CarryTask {
  kind: "carry";
  crates: number;
  from: string;
  to: string;
}

export interface Job {
  id: number;
  title: string;
  employer_npc: string;
  employer_name: string;
  task_type: string;
  pay_c: number;
  risk: string;
  pitch: string;
  task: CarryTask | null;
  source: string;
  status: "offered" | "taken" | "done";
  playable: boolean;
}

export interface Player {
  name: string;
  money_c: number;
  day: number;
  hour: number;
}

export interface JobsPayload {
  board: { state: "writing" | "ready"; source?: string; error?: string };
  jobs: Job[];
  player: Player;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export const api = {
  jobs: () => call<JobsPayload>("GET", "/api/jobs"),
  take: (id: number) => call<{ job: Job }>("POST", `/api/jobs/${id}/take`),
  done: (id: number, delivered: number) =>
    call<{ job: Job; paid_c: number; money_c: number }>("POST", `/api/jobs/${id}/done`, { delivered }),
};

/** Push channel. Reconnects on its own; the game never waits on it. */
export function connectPush(onJobs: (p: JobsPayload) => void): void {
  let delay = 1000;
  const open = () => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws.onopen = () => (delay = 1000);
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as { type: string } & JobsPayload;
      if (msg.type === "jobs") onJobs(msg);
    };
    ws.onclose = () => {
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 15000);
    };
  };
  open();
}
