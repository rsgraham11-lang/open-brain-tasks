// Guards refreshes against local writes: a refresh that started before a mutation settled
// carries pre-mutation server state and must not overwrite the UI. DOM-free.
export function createSyncGuard() {
  let inFlight = 0;
  let version = 0;
  const waiting = new Set(); // callbacks to run once idle (a Set, so the same fn never stacks)

  function begin() {
    inFlight++;
    version++;
  }

  function end() {
    inFlight = Math.max(0, inFlight - 1);
    version++;
    if (inFlight === 0) {
      const fns = [...waiting];
      waiting.clear();
      for (const fn of fns) fn();
    }
  }

  return {
    begin,
    end,
    /** Call as a refresh starts; pass the result to isStale() when its response arrives. */
    snapshot: () => ({ version, busy: inFlight > 0 }),
    isStale: (token) => token.busy || inFlight > 0 || token.version !== version,
    /** Run fn once nothing is in flight (immediately if already idle). Same fn queued twice runs once. */
    onIdle(fn) {
      if (inFlight === 0) fn();
      else waiting.add(fn);
    },
    /** Run a mutation's request: begin() now, end() when it settles, errors rethrown. */
    async run(fn) {
      begin();
      try {
        return await fn();
      } finally {
        end();
      }
    },
  };
}
