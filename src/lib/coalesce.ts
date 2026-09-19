/**
 * Collapsing a burst of identical refetches into one.
 *
 * Three things routinely ask the same screen to reload at the same moment: the
 * screen regaining focus, a Realtime event, and the write the user just made.
 * Left alone that is three identical round trips, and on the feed each one
 * re-reads a hundred bets with every embed — so a cheap write by one person
 * causes an expensive read three times over.
 *
 * The rule is *leading plus one trailing*: the first caller starts the work,
 * everyone who arrives while it is running shares it, and if anyone did arrive
 * the task runs exactly once more afterwards. The trailing run is what keeps
 * this honest — a request that arrived mid-flight might be about a change the
 * in-flight read was already too late to see, so simply sharing the result
 * would silently drop it.
 *
 * Pure, and separate from `use-async.ts`, so the thing worth asserting — how
 * many times the work actually ran — can be asserted without a renderer. Same
 * split as `reminder-rules.ts` and `media-rules.ts`, for the same reason.
 */
export interface Coalescer {
  /**
   * Runs `task`, or joins the run already in progress and guarantees one more
   * afterwards. Resolves when the work the caller cared about has finished.
   */
  run: (task: () => Promise<void>) => Promise<void>;
  /** True while a run is in flight. */
  readonly busy: boolean;
}

export function createCoalescer(): Coalescer {
  let inFlight: Promise<void> | null = null;
  let queued = false;

  async function run(task: () => Promise<void>): Promise<void> {
    if (inFlight) {
      queued = true;
      await inFlight;
      return;
    }

    const cycle = (async () => {
      await task();
      // Drain, rather than loop per queued caller: ten events that arrived
      // during one read are ten reasons to read again, not ten reads.
      while (queued) {
        queued = false;
        await task();
      }
    })();

    inFlight = cycle;
    try {
      await cycle;
    } finally {
      inFlight = null;
      queued = false;
    }
  }

  return {
    run,
    get busy() {
      return inFlight !== null;
    },
  };
}
