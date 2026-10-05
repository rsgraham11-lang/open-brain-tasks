// App state, data loading, actions, and event wiring for the Open Brain task web app.
import { ApiError, AuthError, createApi } from "./api.js";
import { API_BASE } from "./config.js";
import { openTaskDialog } from "./dialog.js";
import {
  ALL_TAGS,
  COMPLETED_DAYS,
  UNDO_MS,
  addDays,
  diffPatch,
  formatDue,
  localToday,
  tagOptions,
  tagStillExists,
} from "./logic.js";
import { createPriorityHandler } from "./priority.js";
import { storage } from "./storage.js";
import { createSyncGuard, createTaskLock } from "./sync.js";
import { renderTab } from "./tabs.js";
import { el, hideBanner, showBanner, showKeyPrompt, showToast } from "./views.js";

const KEY_STORE = "openBrainTasks.appKey";
const TAG_STORE = "openBrainTasks.tagFilter";

let memoryKey = null;
const getKey = () => storage.get(KEY_STORE) ?? memoryKey;
const api = createApi(API_BASE, getKey);
const taskLock = createTaskLock(); // ignores ✓/Done taps while that task's complete/reopen is running
const guard = createSyncGuard(); // local writes in flight; stale refreshes are discarded
const $ = (id) => document.getElementById(id);

const state = {
  tasks: [],
  tags: [],
  today: localToday(),
  tab: "upcoming", // upcoming | priority | all | search
  tag: storage.get(TAG_STORE) ?? ALL_TAGS,
  showCompleted: false,
  query: "",
};

// ---------- errors ----------

const isConnectionError = (err) => err instanceof ApiError && (err.status === 0 || err.status >= 500);

function handleError(err) {
  if (err instanceof AuthError) askForKey("That key was not accepted. Paste the current app key.");
  else if (isConnectionError(err)) showBanner("Couldn't reach Open Brain", refresh);
  else if (err instanceof ApiError) showToast(err.message);
  else {
    console.error(err);
    showToast("Something went wrong");
  }
}

/** For dialog actions: 401 and connection errors are also handled app-wide; the dialog shows every message. */
async function withGlobalErrors(promise) {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof AuthError || isConnectionError(err) || !(err instanceof ApiError)) handleError(err);
    throw err;
  }
}

function askForKey(message = "Paste your Open Brain app key to get started.") {
  showKeyPrompt(message, (key) => {
    memoryKey = key;
    storage.set(KEY_STORE, key);
    refresh();
  });
}

function forgetKey() {
  $("settings-menu").hidden = true;
  storage.remove(KEY_STORE);
  memoryKey = null;
  state.tasks = [];
  state.tags = [];
  renderView();
  askForKey("The key was removed from this device. Paste a key to reconnect.");
}

// ---------- loading ----------

async function refresh() {
  if (!getKey()) {
    askForKey();
    return;
  }
  const token = guard.snapshot();
  try {
    const since = addDays(localToday(), -COMPLETED_DAYS);
    const [list, tags] = await Promise.all([api.listTasks(since), api.listTags()]);
    if (guard.isStale(token)) return guard.onIdle(refresh); // a write raced this load; reload once it settles
    state.today = list.today;
    state.tasks = list.tasks;
    state.tags = tags;
    // Full load only: a stored tag that no task carries any more falls back to All tags.
    if (!tagStillExists(state.tag, tags, list.tasks)) setTag(ALL_TAGS);
    hideBanner();
    render();
  } catch (err) {
    handleError(err);
  }
}

async function refreshTags() {
  try {
    state.tags = await api.listTags();
    renderTagFilter(); // never changes state.tag
  } catch { /* the next refresh tries again */ }
}

// ---------- rendering ----------

const rowHandlers = {
  onCheck: (t) => taskLock.run(t.id, () => (t.status === "open" ? completeTask(t) : reopenTask(t))),
  onOpen: (t) => (t.status === "open" ? editTask(t) : reopenTask(t)),
  onPriority: createPriorityHandler({
    save: (t, priority) => api.updateTask(t.short_id, { priority }),
    getTask: (id) => state.tasks.find((t) => t.id === id),
    replaceTask, render: renderView, onError: handleError, guard,
  }),
};

const tabActions = {
  setShowCompleted: (on) => {
    state.showCompleted = on;
    renderView();
  },
  setQuery: (text) => {
    state.query = text;
    renderView();
  },
};

function render() {
  renderTagFilter();
  renderTabs();
  renderView();
}

function renderView() {
  renderTab($("view"), state, rowHandlers, tabActions);
}

function setTag(tag) {
  state.tag = tag;
  storage.set(TAG_STORE, tag);
  renderView();
}

function renderTagFilter() {
  const options = tagOptions(state.tags, state.tag);
  const select = $("tag-filter");
  select.replaceChildren(...options.map((o) => el("option", { value: o.value, text: o.label })));
  select.value = state.tag;
}

function renderTabs() {
  for (const b of document.querySelectorAll("[data-tab]")) {
    b.setAttribute("aria-selected", String(b.dataset.tab === state.tab));
  }
}

// ---------- actions ----------

function replaceTask(updated) {
  state.tasks = state.tasks.map((t) => (t.id === updated.id ? updated : t));
}

async function completeTask(task) {
  replaceTask({ ...task, status: "done", completed_at: new Date().toISOString() }); // optimistic
  renderView();
  try {
    const { done, next } = await guard.run(() => api.completeTask(task.short_id));
    replaceTask(done);
    if (next) state.tasks = [...state.tasks, next];
    renderView();
    const suffix = next?.due_date ? ` · next ${formatDue(next.due_date, state.today)}` : "";
    showToast(`Completed: ${task.title}${suffix}`, { label: "Undo", run: () => undoComplete(done, next) }, UNDO_MS);
    refreshTags();
  } catch (err) {
    replaceTask(task); // roll back
    renderView();
    handleError(err);
  }
}

/** Undo = reopen the task first, then delete the next occurrence the completion created (if any). */
async function undoComplete(done, next) {
  try {
    replaceTask(await guard.run(() => api.updateTask(done.short_id, { status: "open" })));
    renderView();
  } catch (err) {
    handleError(err);
    refresh();
    return;
  }
  try {
    if (next) {
      await guard.run(() => api.deleteTask(next.short_id));
      state.tasks = state.tasks.filter((t) => t.id !== next.id);
      renderView();
    }
  } catch (err) {
    handleError(err);
    refresh();
    showToast("Reopened, but the next occurrence could not be deleted. It is now a duplicate; delete it by hand.", null, 10000);
    return;
  }
  refreshTags();
}

async function reopenTask(task) {
  replaceTask({ ...task, status: "open", completed_at: null }); // optimistic
  renderView();
  try {
    replaceTask(await guard.run(() => api.updateTask(task.short_id, { status: "open" })));
    renderView();
    refreshTags();
    showToast(`Reopened: ${task.title}`);
  } catch (err) {
    replaceTask(task); // roll back
    renderView();
    handleError(err);
  }
}

const tagNames = () => state.tags.map((t) => t.tag).sort();

function addTask() {
  openTaskDialog(null, tagNames(), {
    onSave: async (fields) => {
      const task = await withGlobalErrors(guard.run(() => api.createTask(fields)));
      state.tasks = [...state.tasks, task];
      renderView();
      refreshTags();
    },
  });
}

function editTask(task) {
  openTaskDialog(task, tagNames(), {
    onSave: async (fields) => {
      const patch = diffPatch(task, fields);
      if (!Object.keys(patch).length) return;
      replaceTask(await withGlobalErrors(guard.run(() => api.updateTask(task.short_id, patch))));
      renderView();
      refreshTags();
    },
    onComplete: () => completeTask(task),
    onDelete: async () => {
      await withGlobalErrors(guard.run(() => api.deleteTask(task.short_id)));
      state.tasks = state.tasks.filter((t) => t.id !== task.id);
      renderView();
      refreshTags();
      showToast(`Deleted: ${task.title}`);
    },
  });
}

// ---------- wiring ----------

function wire() {
  $("add-btn").addEventListener("click", addTask);
  $("tag-filter").addEventListener("change", (e) => {
    setTag(e.target.value);
    renderTagFilter();
  });
  for (const b of document.querySelectorAll("[data-tab]")) {
    b.addEventListener("click", () => {
      state.tab = b.dataset.tab;
      renderTabs();
      renderView();
    });
  }
  $("settings-btn").addEventListener("click", () => ($("settings-menu").hidden = !$("settings-menu").hidden));
  $("forget-key-btn").addEventListener("click", forgetKey);
  document.addEventListener("click", (e) => {
    const menu = $("settings-menu");
    if (!menu.hidden && !menu.contains(e.target) && !$("settings-btn").contains(e.target)) menu.hidden = true;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
}

wire();
renderTabs();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
refresh();
