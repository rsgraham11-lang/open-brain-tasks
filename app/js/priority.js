// The H/N/L buttons on task rows: optimistic save with rollback, one request per task at a time.
import { nextPriority } from "./logic.js";
import { createSyncGuard } from "./sync.js";

/**
 * deps: {save(task, priority) -> Promise<task>, getTask(id) -> task | undefined,
 *        replaceTask(task), render(), onError(err), guard?}
 * guard (a sync guard) brackets each save so a concurrent refresh cannot overwrite it.
 * Returns setPriority(task, tapped), where tapped is 1, 2, or 3. Only the priority field of the
 * task in state is changed, so a completion made while the request is in flight is kept.
 */
export function createPriorityHandler({ save, getTask, replaceTask, render, onError, guard = createSyncGuard() }) {
  const inFlight = new Set(); // task ids with a priority request pending

  function setField(id, priority) {
    const current = getTask(id);
    if (current) replaceTask({ ...current, priority });
  }

  return async function setPriority(task, tapped) {
    if (inFlight.has(task.id)) return; // ignore taps until the pending request settles
    inFlight.add(task.id);
    const before = getTask(task.id)?.priority ?? null;
    const next = nextPriority(before, tapped);
    setField(task.id, next); // optimistic
    render();
    try {
      const saved = await guard.run(() => save(task, next));
      setField(task.id, saved.priority ?? null);
      render();
    } catch (err) {
      setField(task.id, before); // roll back
      render();
      onError(err);
    } finally {
      inFlight.delete(task.id);
    }
  };
}
