// Pure helpers for the task web app: no DOM and no network, so `node --test` covers them.
// Dates are "YYYY-MM-DD" strings; tasks are the objects returned by the task API.

export const COMPLETED_DAYS = 30; // "Show completed" covers tasks done in the last 30 days
export const UNDO_MS = 5000; // how long the Undo toast stays up
export const ALL_TAGS = "__all__";
export const NO_TAG = "__none__";
export const PRIORITIES = [
  { value: 1, label: "High" },
  { value: 2, label: "Normal" },
  { value: 3, label: "Low" },
  { value: null, label: "None" },
];
export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EDITABLE_FIELDS = ["title", "tags", "priority", "due_date", "recurrence", "notes"];

function toUtcDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso, n) {
  const d = toUtcDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today's date in the device's local time zone. */
export function localToday(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Same rules as the server: trim, drop leading #, lowercase, spaces become "-". */
export function normalizeTag(tag) {
  return tag.trim().replace(/^#+/, "").trim().toLowerCase().replace(/\s+/g, "-");
}

/** tag is ALL_TAGS, NO_TAG, or a tag name. */
export function filterByTag(tasks, tag) {
  if (tag === ALL_TAGS) return tasks;
  if (tag === NO_TAG) return tasks.filter((t) => t.tags.length === 0);
  return tasks.filter((t) => t.tags.includes(tag));
}

function nullsLast(a, b) {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Due date ascending (nulls last), then priority ascending (nulls last), then short_id. */
export function sortTasks(tasks) {
  return [...tasks].sort(
    (a, b) => nullsLast(a.due_date, b.due_date) || nullsLast(a.priority, b.priority) || a.short_id - b.short_id,
  );
}

/** Open tasks with a due date: Overdue / Today, This week (next 7 days), Later. Empty groups are dropped. */
export function groupUpcoming(tasks, today) {
  const weekEnd = addDays(today, 7);
  const dated = sortTasks(tasks.filter((t) => t.status === "open" && t.due_date));
  return [
    { title: "Overdue / Today", tasks: dated.filter((t) => t.due_date <= today) },
    { title: "This week", tasks: dated.filter((t) => t.due_date > today && t.due_date <= weekEnd) },
    { title: "Later", tasks: dated.filter((t) => t.due_date > weekEnd) },
  ].filter((g) => g.tasks.length > 0);
}

/** Open tasks grouped High / Normal / Low / No priority. Empty groups are dropped. */
export function groupByPriority(tasks) {
  const open = sortTasks(tasks.filter((t) => t.status === "open"));
  return [
    { title: "High", tasks: open.filter((t) => t.priority === 1) },
    { title: "Normal", tasks: open.filter((t) => t.priority === 2) },
    { title: "Low", tasks: open.filter((t) => t.priority === 3) },
    { title: "No priority", tasks: open.filter((t) => ![1, 2, 3].includes(t.priority)) },
  ].filter((g) => g.tasks.length > 0);
}

/** Case-insensitive match on title and notes; an empty query matches nothing. */
export function searchTasks(tasks, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return sortTasks(
    tasks.filter((t) => t.title.toLowerCase().includes(needle) || (t.notes ?? "").toLowerCase().includes(needle)),
  );
}

/** Done tasks, most recently completed first. */
export function recentlyCompleted(tasks) {
  return tasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
}

/**
 * Dropdown options: All tags, each tag with open tasks (alphabetical, with count), No tag.
 * The selected tag is always listed (count 0 if it has no open tasks) so the dropdown matches the list.
 */
export function tagOptions(tags, selected = ALL_TAGS) {
  const counts = new Map(tags.filter((t) => t.open_count > 0).map((t) => [t.tag, t.open_count]));
  if (selected && selected !== ALL_TAGS && selected !== NO_TAG && !counts.has(selected)) counts.set(selected, 0);
  const named = [...counts]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tag, n]) => ({ value: tag, label: `#${tag} (${n})` }));
  return [{ value: ALL_TAGS, label: "All tags" }, ...named, { value: NO_TAG, label: "No tag" }];
}

/** True if the choice is a special filter, a known tag, or carried by any loaded task (open or done). */
export function tagStillExists(choice, tags, tasks) {
  if (choice === ALL_TAGS || choice === NO_TAG) return true;
  return tags.some((t) => t.tag === choice) || tasks.some((t) => t.tags.includes(choice));
}

/**
 * The recurrence part of the dialog's fields. An existing task's rule is left alone unless the user
 * touched a repeat control; a new task only gets a rule when one is chosen.
 */
export function repeatFields(isNew, touched, form) {
  if (isNew) {
    const rule = buildRepeat(form);
    return rule === null ? {} : { recurrence: rule };
  }
  return touched ? { recurrence: buildRepeat(form) } : {};
}

/** The stored choice if it is still an option, otherwise ALL_TAGS. */
export function resolveTagChoice(choice, options) {
  return options.some((o) => o.value === choice) ? choice : ALL_TAGS;
}

/** "today", a weekday within the next 6 days ("Thu"), "Oct 5" this year, "Feb 10, 2027" otherwise. */
export function formatDue(date, today) {
  if (date === today) return "today";
  const d = toUtcDate(date);
  if (date > today && date <= addDays(today, 6)) return DAY_NAMES[d.getUTCDay()];
  const label = `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return date.slice(0, 4) === today.slice(0, 4) ? label : `${label}, ${date.slice(0, 4)}`;
}

/**
 * Recurrence rule -> repeat form state. Grammar: "every N days|weeks|months|years",
 * "weekly:mon,thu", "monthly:15". Anything else (or null) is "none".
 */
export function parseRepeat(rule) {
  const base = { kind: "none", n: 1, unit: "weeks", days: [], day: 1 };
  const r = (rule ?? "").trim().toLowerCase();
  let m = r.match(/^every\s+(\d+)\s+(day|week|month|year)s?$/);
  if (m) return { ...base, kind: "every", n: Number(m[1]), unit: `${m[2]}s` };
  m = r.match(/^weekly:([a-z,\s]+)$/);
  if (m) {
    const days = m[1].split(",").map((s) => s.trim()).filter((s) => WEEKDAY_KEYS.includes(s));
    return { ...base, kind: "weekly", days };
  }
  m = r.match(/^monthly:(\d{1,2})$/);
  if (m) return { ...base, kind: "monthly", day: Number(m[1]) };
  return base;
}

/** Repeat form state -> recurrence rule (or null for none). Throws Error with a user-facing message. */
export function buildRepeat(form) {
  if (form.kind === "every") {
    const n = Number(form.n);
    if (!Number.isInteger(n) || n < 1) throw new Error("Repeat every: enter a whole number of 1 or more.");
    return `every ${n} ${form.unit}`;
  }
  if (form.kind === "weekly") {
    const days = WEEKDAY_KEYS.filter((d) => form.days.includes(d));
    if (!days.length) throw new Error("Weekly repeat: pick at least one day.");
    return `weekly:${days.join(",")}`;
  }
  if (form.kind === "monthly") {
    const day = Number(form.day);
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("Monthly repeat: pick a day from 1 to 31.");
    return `monthly:${day}`;
  }
  return null;
}

/** Only the editable fields whose values differ from the task (tags compared by value). */
export function diffPatch(task, fields) {
  const patch = {};
  for (const key of EDITABLE_FIELDS) {
    if (!(key in fields)) continue; // absent = not edited
    const before = task[key] ?? null;
    const after = fields[key] ?? null;
    const same = Array.isArray(before) || Array.isArray(after)
      ? JSON.stringify(before ?? []) === JSON.stringify(after ?? [])
      : before === after;
    if (!same) patch[key] = after;
  }
  return patch;
}
