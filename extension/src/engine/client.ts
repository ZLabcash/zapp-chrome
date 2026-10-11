// Calls into the engine worker.

import type { SyncState } from "./worker";

export type { SyncState };

export class EngineClient {
  private worker: Worker;
  private next = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  onSync: (s: SyncState) => void = () => {};
  onChanged: () => void = () => {};

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onerror = (e) => console.error("[engine] worker error", e.message);
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.event === "sync") return this.onSync(m.state);
      if (m.event === "changed") return this.onChanged();
      if (m.event === "log") return console.log("[engine]", m.text);
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.ok ? p.resolve(m.value) : p.reject(new Error(m.error));
    };
  }

  call<T = any>(call: string, ...args: unknown[]): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, call, args });
    });
  }
}
