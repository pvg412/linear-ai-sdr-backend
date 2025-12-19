export interface PollOptions<T> {
  intervalMs: number;
  maxAttempts: number;

  /**
   * Called every attempt. Return current state.
   */
  task: (attempt: number) => Promise<T>;

  /**
   * If true -> stop and return T.
   */
  isDone: (value: T) => boolean;

  /**
   * If returns string -> throw Error(string).
   */
  isError?: (value: T) => string | false;

  /**
   * Optional hook for logging.
   */
  onAttempt?: (ctx: { attempt: number; value: T }) => void;
}

export async function pollUntil<T>(opts: PollOptions<T>): Promise<T> {
  for (let i = 1; i <= opts.maxAttempts; i++) {
    const value = await opts.task(i);

    opts.onAttempt?.({ attempt: i, value });

    const err = opts.isError?.(value);
    if (typeof err === "string" && err.length > 0) {
      throw new Error(err);
    }

    if (opts.isDone(value)) return value;

    await sleep(opts.intervalMs);
  }

  throw new Error(`Polling timed out after ${opts.maxAttempts} attempts`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
