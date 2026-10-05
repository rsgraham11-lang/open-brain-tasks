// DOM rendering helpers. Task data only reaches the page through textContent, element
// properties, or setAttribute — never by parsing HTML strings.
import { PRIORITIES, formatDue } from "./logic.js";

const PROPERTIES = new Set(["value", "checked", "disabled", "selected"]);
const ROW_PRIORITIES = PRIORITIES.filter((p) => p.value !== null); // High, Normal, Low

/**
 * el("button", {class: "x", text: "Hi", onclick: fn, "aria-label": "..."}, ...children)
 * Props: class, text (textContent), on<event> (listener), value/checked/disabled/selected (properties),
 * anything else becomes an attribute (true -> ""). undefined/null/false props and children are skipped.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (PROPERTIES.has(key)) node[key] = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child !== undefined && child !== null && child !== false) node.append(child);
  }
  return node;
}

/**
 * One task: a Done button, the H/N/L priority column (open tasks only), and a tappable body.
 * handlers: {onCheck(task), onOpen(task), onPriority(task, priority)}; priority is 1, 2, or 3.
 */
export function taskRow(task, today, handlers) {
  const done = task.status === "done";
  const meta = [];
  if (task.due_date) {
    const overdue = !done && task.due_date < today;
    meta.push(el("span", { class: overdue ? "due overdue" : "due", text: formatDue(task.due_date, today) }));
  }
  if (task.recurrence) meta.push(el("span", { class: "repeat", text: `↻ ${task.recurrence}` }));
  for (const tag of task.tags) meta.push(el("span", { class: "tag", text: `#${tag}` }));

  return el(
    "li",
    { class: done ? "task done" : "task" },
    el(
      "button",
      {
        type: "button",
        class: done ? "done-btn checked" : "done-btn",
        "aria-label": `${done ? "Reopen" : "Complete"}: ${task.title}`,
        onclick: () => handlers.onCheck(task),
      },
      el("span", { class: "done-label", text: done ? "✓" : "Done" }),
    ),
    done ? null : priorityColumn(task, handlers.onPriority),
    el(
      "button",
      { type: "button", class: "row-body", onclick: () => handlers.onOpen(task) },
      el("span", { class: "title", text: task.title }),
      meta.length ? el("span", { class: "meta" }, meta) : null,
    ),
  );
}

/** Three stacked toggle buttons, H / N / L; the task's current priority is pressed. */
function priorityColumn(task, onPriority) {
  return el(
    "div",
    { class: "prio-col", role: "group", "aria-label": "Priority" },
    ROW_PRIORITIES.map((p) =>
      el("button", {
        type: "button",
        class: `prio-btn prio-btn-${p.value}`,
        "aria-pressed": String(task.priority === p.value),
        "aria-label": `${p.label} priority: ${task.title}`,
        text: p.label.charAt(0),
        onclick: () => onPriority(task, p.value),
      })
    ),
  );
}

/** groups: [{title, tasks}]. A falsy title renders no heading. Shows emptyText when every group is empty. */
export function taskGroups(groups, today, handlers, emptyText) {
  const shown = groups.filter((g) => g.tasks.length > 0);
  if (!shown.length) return el("p", { class: "empty", text: emptyText });
  return el(
    "div",
    { class: "groups" },
    shown.map((g) =>
      el(
        "section",
        { class: "group" },
        g.title ? el("h2", { text: `${g.title} · ${g.tasks.length}` }) : null,
        el("ul", { class: "tasks" }, g.tasks.map((t) => taskRow(t, today, handlers))),
      )
    ),
  );
}

const byId = (id) => document.getElementById(id);

export function showBanner(text, onRetry) {
  byId("banner-text").textContent = text;
  byId("banner-retry").onclick = onRetry;
  byId("banner").hidden = false;
}

export function hideBanner() {
  byId("banner").hidden = true;
}

let toastTimer = null;

/** action: {label, run} or null. Hides itself after ms. */
export function showToast(text, action = null, ms = 5000) {
  const button = byId("toast-action");
  byId("toast-text").textContent = text;
  button.hidden = !action;
  button.onclick = action
    ? () => {
      hideToast();
      action.run();
    }
    : null;
  if (action) button.textContent = action.label;
  byId("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}

export function hideToast() {
  clearTimeout(toastTimer);
  byId("toast").hidden = true;
}

/** Modal key prompt. onSave(key) gets the trimmed key. It cannot be dismissed without a key. */
export function showKeyPrompt(message, onSave) {
  const dialog = byId("key-dialog");
  const input = el("input", {
    type: "password",
    id: "key-input",
    autocomplete: "off",
    spellcheck: "false",
    required: true,
  });
  const form = el(
    "form",
    {},
    el("h2", { text: "Connect to Open Brain" }),
    el("p", { text: message }),
    el("p", {
      class: "hint",
      text:
        "On your PC, open agent\\secrets\\app-key.txt in the Open Brain folder and copy the key. It is saved only in this browser, on this device.",
    }),
    el("label", { for: "key-input", text: "App key" }),
    input,
    el("div", { class: "actions" }, el("button", { type: "submit", class: "primary", text: "Save key" })),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const key = input.value.trim();
    if (!key) return;
    dialog.close();
    onSave(key);
  });
  dialog.oncancel = (e) => e.preventDefault();
  dialog.replaceChildren(form);
  if (!dialog.open) dialog.showModal();
  input.focus();
}
