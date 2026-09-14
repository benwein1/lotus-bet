import { createCoalescer } from '@/lib/coalesce';

/**
 * These assert a *number*: how many times the work actually runs when several
 * things ask for the same refetch at once. That number is the whole point of
 * the module — on the feed it used to be one round trip per asker, and each
 * round trip re-read a hundred bets with every embed.
 */

/** A task that only finishes when told to, so overlap is deterministic. */
function controllable() {
  let runs = 0;
  const waiting: (() => void)[] = [];

  const task = () => {
    runs += 1;
    return new Promise<void>((resolve) => waiting.push(resolve));
  };

  return {
    task,
    get runs() {
      return runs;
    },
    /** Lets the oldest in-flight run finish, then drains the microtask queue. */
    async release() {
      waiting.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    },
    async releaseAll() {
      while (waiting.length > 0) await this.release();
    },
  };
}

describe('createCoalescer', () => {
  it('runs the task immediately for the first caller', async () => {
    const c = controllable();
    const coalescer = createCoalescer();

    void coalescer.run(c.task);
    expect(c.runs).toBe(1);
  });

  // The measurement that matters.
  it('collapses six concurrent asks into two runs', async () => {
    const c = controllable();
    const coalescer = createCoalescer();

    const all = [
      coalescer.run(c.task),
      coalescer.run(c.task),
      coalescer.run(c.task),
      coalescer.run(c.task),
      coalescer.run(c.task),
      coalescer.run(c.task),
    ];

    // Five of the six joined the one already running.
    expect(c.runs).toBe(1);

    await c.release(); // first run lands -> exactly one trailing re-run
    expect(c.runs).toBe(2);

    await c.releaseAll();
    await Promise.all(all);

    // Six asks, two round trips.
    expect(c.runs).toBe(2);
  });

  it('does not queue a trailing run when nothing arrived during the first', async () => {
    const c = controllable();
    const coalescer = createCoalescer();

    const only = coalescer.run(c.task);
    await c.release();
    await only;

    expect(c.runs).toBe(1);
  });

  it('starts fresh once the burst has settled', async () => {
    const c = controllable();
    const coalescer = createCoalescer();

    const first = coalescer.run(c.task);
    await c.release();
    await first;
    expect(c.runs).toBe(1);

    const second = coalescer.run(c.task);
    await c.release();
    await second;
    expect(c.runs).toBe(2);
  });

  it('reports whether work is in flight', async () => {
    const c = controllable();
    const coalescer = createCoalescer();
    expect(coalescer.busy).toBe(false);

    const run = coalescer.run(c.task);
    expect(coalescer.busy).toBe(true);

    await c.release();
    await run;
    expect(coalescer.busy).toBe(false);
  });

  // A failed refetch must not wedge the coalescer shut, or the screen can
  // never reload again — a far worse outcome than the failure itself.
  it('recovers from a task that throws', async () => {
    const coalescer = createCoalescer();
    const boom = () => Promise.reject(new Error('network'));

    await expect(coalescer.run(boom)).rejects.toThrow('network');
    expect(coalescer.busy).toBe(false);

    let ran = false;
    await coalescer.run(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('waits for the work before resolving a joined caller', async () => {
    const c = controllable();
    const coalescer = createCoalescer();
    const order: string[] = [];

    const first = coalescer.run(c.task).then(() => order.push('first'));
    const joined = coalescer.run(c.task).then(() => order.push('joined'));

    await c.releaseAll();
    await Promise.all([first, joined]);

    expect(order).toHaveLength(2);
    expect(c.runs).toBe(2);
  });
});
