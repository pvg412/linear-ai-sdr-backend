type ThreadId = string;

/**
 * Minimal socket shape we rely on.
 * We keep this structural (instead of importing `ws` types) to avoid
 * type-resolution issues that can cause the socket to become an `error` type
 * in type-aware ESLint rules.
 */
type RealtimeSocket = {
  readonly readyState: number;
  on(event: "close" | "error", listener: () => void): void;
  send(data: string): void;
};

const WS_READY_STATE_OPEN = 1;

function isOpen(ws: RealtimeSocket): boolean {
  // ws.OPEN === 1, but we don't want to expose magic numbers
  return ws.readyState === WS_READY_STATE_OPEN;
}

export class RealtimeHub {
  private readonly threads = new Map<ThreadId, Set<RealtimeSocket>>();

  subscribe(threadId: ThreadId, socket: RealtimeSocket): void {
    let set = this.threads.get(threadId);
    if (!set) {
      set = new Set<RealtimeSocket>();
      this.threads.set(threadId, set);
    }

    set.add(socket);

    socket.on("close", () => {
      this.unsubscribe(threadId, socket);
    });

    socket.on("error", () => {
      // on error -> drop connection from hub to avoid leaks
      this.unsubscribe(threadId, socket);
    });
  }

  unsubscribe(threadId: ThreadId, socket: RealtimeSocket): void {
    const set = this.threads.get(threadId);
    if (!set) return;

    set.delete(socket);

    if (set.size === 0) {
      this.threads.delete(threadId);
    }
  }

  broadcast(threadId: ThreadId, event: unknown): void {
    const set = this.threads.get(threadId);
    if (!set || set.size === 0) return;

    let payload: string;
    try {
      payload = JSON.stringify(event);
    } catch {
      // never throw on broadcast
      return;
    }

    for (const ws of set) {
      if (!isOpen(ws)) continue;
      try {
        ws.send(payload);
      } catch {
        // ignore send failures
      }
    }
  }
}
