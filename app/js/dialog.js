// The add/edit task dialog. Built with DOM calls only, never from HTML strings.
import { normalizeTag, parseRepeat, PRIORITIES, repeatFields, WEEKDAY_KEYS } from "./logic.js";
import { el } from "./views.js";

const UNITS = ["days", "weeks", "months", "years"];
const REPEAT_KINDS = [
  ["none", "Doesn't repeat"],
  ["every", "Every N days, weeks, months, or years"],
  ["weekly", "Weekly on certain days"],
  ["monthly", "Monthly on a day"],
];

function field(label, forId, ...controls) {
  return el("div", { class: "field" }, el("label", { for: forId, text: label }), ...controls);
}

let currentToken = 0; // each dialog open gets a new token; stale requests must not touch a newer dialog

/**
 * Opens the dialog for `task`, or for a new task when task is null.
 * allTags: existing tag names (for autocomplete).
 * handlers: {onSave(fields), onDelete(), onComplete()} returning promises. onDelete/onComplete are
 * only used for existing tasks. A rejected promise keeps the dialog open and shows err.message.
 * fields = {title, tags, priority, due_date, recurrence, notes}
 */
export function openTaskDialog(task, allTags, handlers) {
  const dialog = document.getElementById("task-dialog");
  const isNew = !task;
  const token = ++currentToken;
  let repeatTouched = false;
  let priority = isNew ? null : task.priority;
  let tags = isNew ? [] : [...task.tags];
  const repeat = parseRepeat(isNew ? null : task.recurrence);
  let days = [...repeat.days];

  const title = el("input", {
    type: "text",
    id: "f-title",
    maxlength: "500",
    autocomplete: "off",
    required: true,
    value: isNew ? "" : task.title,
  });

  const priorityButtons = PRIORITIES.map((p) =>
    el("button", {
      type: "button",
      class: "seg",
      text: p.label,
      onclick: () => {
        priority = p.value;
        syncPriority();
      },
    })
  );
  function syncPriority() {
    priorityButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(PRIORITIES[i].value === priority)));
  }

  const chips = el("div", { class: "chips" });
  const tagInput = el("input", {
    type: "text",
    id: "f-tag",
    list: "tag-suggestions",
    autocomplete: "off",
    enterkeyhint: "done",
    placeholder: "Add a tag",
  });
  const suggestions = el("datalist", { id: "tag-suggestions" }, allTags.map((t) => el("option", { value: t })));
  function renderChips() {
    chips.replaceChildren(
      ...tags.map((t) =>
        el(
          "span",
          { class: "chip" },
          `#${t}`,
          el("button", {
            type: "button",
            class: "chip-x",
            "aria-label": `Remove tag ${t}`,
            text: "×",
            onclick: () => {
              tags = tags.filter((x) => x !== t);
              renderChips();
            },
          }),
        )
      ),
    );
  }
  function commitTagInput() {
    for (const part of tagInput.value.split(",")) {
      const t = normalizeTag(part);
      if (t && !tags.includes(t)) tags.push(t);
    }
    tagInput.value = "";
    renderChips();
  }
  tagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitTagInput();
    }
  });
  tagInput.addEventListener("input", () => {
    if (tagInput.value.includes(",")) commitTagInput();
  });
  tagInput.addEventListener("change", commitTagInput);

  const due = el("input", { type: "date", id: "f-due", value: isNew ? "" : task.due_date ?? "" });
  const clearDue = el("button", { type: "button", class: "link", text: "Clear", onclick: () => (due.value = "") });

  const kind = el("select", { id: "f-repeat" }, REPEAT_KINDS.map(([v, label]) => el("option", { value: v, text: label })));
  kind.value = repeat.kind;
  const everyN = el("input", { type: "number", min: "1", step: "1", inputmode: "numeric", "aria-label": "How many" });
  everyN.value = String(repeat.n);
  const everyUnit = el("select", { "aria-label": "Unit" }, UNITS.map((u) => el("option", { value: u, text: u })));
  everyUnit.value = repeat.unit;
  const everyRow = el("div", { class: "inline" }, "Every", everyN, everyUnit);
  const dayButtons = WEEKDAY_KEYS.map((d) =>
    el("button", {
      type: "button",
      class: "day",
      text: d[0].toUpperCase() + d.slice(1),
      "aria-pressed": String(days.includes(d)),
      onclick: (e) => {
        days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
        e.currentTarget.setAttribute("aria-pressed", String(days.includes(d)));
      },
    })
  );
  const weeklyRow = el("div", { class: "inline days" }, dayButtons);
  const monthDay = el("input", { type: "number", min: "1", max: "31", inputmode: "numeric", "aria-label": "Day of month" });
  monthDay.value = String(repeat.day);
  const monthlyRow = el("div", { class: "inline" }, "Day", monthDay, "of each month");
  function syncRepeat() {
    everyRow.hidden = kind.value !== "every";
    weeklyRow.hidden = kind.value !== "weekly";
    monthlyRow.hidden = kind.value !== "monthly";
  }
  kind.addEventListener("change", syncRepeat);

  for (const row of [kind, everyRow, weeklyRow, monthlyRow]) {
    for (const ev of ["input", "change"]) row.addEventListener(ev, () => (repeatTouched = true));
  }

  const notes = el("textarea", { id: "f-notes", rows: "4", value: isNew ? "" : task.notes ?? "" });
  const error = el("p", { class: "dialog-error", role: "alert", hidden: true });

  const save = el("button", { type: "submit", class: "primary", text: isNew ? "Add" : "Save" });
  const cancel = el("button", { type: "button", text: "Cancel", onclick: () => dialog.close() });
  const complete = !isNew && task.status === "open"
    ? el("button", { type: "button", text: "Complete", onclick: () => run(handlers.onComplete) })
    : null;
  const del = isNew ? null : el("button", {
    type: "button",
    class: "danger",
    text: "Delete",
    onclick: () => {
      if (confirm(`Are you sure? "${task.title}" (T-${task.short_id}) will be deleted permanently.`)) {
        run(handlers.onDelete);
      }
    },
  });
  const busyButtons = [save, complete, del].filter(Boolean);

  function readFields() {
    commitTagInput();
    const text = title.value.trim();
    if (!text) throw new Error("Enter the task text.");
    return {
      title: text,
      tags: [...tags],
      priority,
      due_date: due.value || null,
      notes: notes.value.trim() ? notes.value.replace(/\s+$/, "") : null,
      ...repeatFields(isNew, repeatTouched, { kind: kind.value, n: everyN.value, unit: everyUnit.value, days, day: monthDay.value }),
    };
  }

  async function run(action) {
    error.hidden = true;
    busyButtons.forEach((b) => (b.disabled = true));
    try {
      await action();
      if (token === currentToken) dialog.close();
    } catch (e) {
      if (token !== currentToken) return;
      error.textContent = e.message;
      error.hidden = false;
    } finally {
      busyButtons.forEach((b) => (b.disabled = false));
    }
  }

  const form = el(
    "form",
    {},
    el("h2", { text: isNew ? "New task" : `Edit T-${task.short_id}` }),
    field("Task", "f-title", title),
    el("div", { class: "field" }, el("span", { class: "field-label", text: "Priority" }), el("div", { class: "segmented", role: "group", "aria-label": "Priority" }, priorityButtons)),
    field("Tags", "f-tag", chips, tagInput, suggestions),
    field("Due date", "f-due", el("div", { class: "inline" }, due, clearDue)),
    field("Repeat", "f-repeat", kind, everyRow, weeklyRow, monthlyRow),
    field("Notes", "f-notes", notes),
    error,
    el("div", { class: "actions" }, del, complete, cancel, save),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => handlers.onSave(readFields()));
  });

  syncPriority();
  renderChips();
  syncRepeat();
  dialog.replaceChildren(form);
  dialog.showModal();
  if (isNew) title.focus();
}
