// Builds the content of the four tabs from app state. Holds no state of its own.
import {
  COMPLETED_DAYS,
  filterByTag,
  groupByPriority,
  groupUpcoming,
  recentlyCompleted,
  searchTasks,
  sortTasks,
} from "./logic.js";
import { el, taskGroups } from "./views.js";

/**
 * state: {tasks, today, tab, tag, showCompleted, query}
 * handlers: {onCheck(task), onOpen(task), onPriority(task, priority)} for task rows
 * actions: {setShowCompleted(on), setQuery(text)}; each updates state and calls renderTab again
 */
export function renderTab(view, state, handlers, actions) {
  const today = state.today;
  const open = filterByTag(state.tasks.filter((t) => t.status === "open"), state.tag);
  if (state.tab === "upcoming") {
    view.replaceChildren(taskGroups(groupUpcoming(open, today), today, handlers, "Nothing with a due date."));
  } else if (state.tab === "priority") {
    view.replaceChildren(taskGroups(groupByPriority(open), today, handlers, "No open tasks."));
  } else if (state.tab === "all") {
    view.replaceChildren(...allTab(state, open, handlers, actions));
  } else {
    searchTab(view, state, open, handlers, actions);
  }
}

function allTab(state, open, handlers, actions) {
  const toggle = el("input", {
    type: "checkbox",
    id: "show-completed",
    checked: state.showCompleted,
    onchange: (e) => actions.setShowCompleted(e.target.checked),
  });
  const parts = [
    taskGroups([{ title: "", tasks: sortTasks(open) }], state.today, handlers, "No open tasks."),
    el("label", { class: "toggle", for: "show-completed" }, toggle, `Show completed (last ${COMPLETED_DAYS} days)`),
  ];
  if (state.showCompleted) {
    const done = recentlyCompleted(filterByTag(state.tasks, state.tag));
    parts.push(
      taskGroups(
        [{ title: "Completed · tap to reopen", tasks: done }],
        state.today,
        handlers,
        `Nothing completed in the last ${COMPLETED_DAYS} days.`,
      ),
    );
  }
  return parts;
}

// The search box is created once per visit to the tab so typing never loses focus;
// later renders only replace the results.
function searchTab(view, state, open, handlers, actions) {
  let input = view.querySelector("#search-input");
  let results = view.querySelector("#search-results");
  if (!input) {
    input = el("input", {
      type: "search",
      id: "search-input",
      placeholder: "Search open tasks",
      "aria-label": "Search open tasks",
      value: state.query,
      oninput: (e) => actions.setQuery(e.target.value),
    });
    results = el("div", { id: "search-results" });
    view.replaceChildren(input, results);
    input.focus();
  }
  results.replaceChildren(
    state.query.trim()
      ? taskGroups([{ title: "", tasks: searchTasks(open, state.query) }], state.today, handlers, "No matches.")
      : el("p", { class: "empty", text: "Type to search task text and notes." }),
  );
}
