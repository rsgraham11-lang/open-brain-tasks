// Thin client for the Open Brain task routes. Every request sends the app key in x-task-key.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status; // 0 means the request never got a response (offline, DNS, CORS)
  }
}

export class AuthError extends ApiError {
  constructor(message) {
    super(401, message || "Invalid or missing task key");
    this.name = "AuthError";
  }
}

export function createApi(baseUrl, getKey, fetchFn = (url, init) => fetch(url, init)) {
  async function request(method, path, body) {
    const headers = { "x-task-key": getKey() ?? "" };
    const init = { method, headers, cache: "no-store" };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetchFn(`${baseUrl}${path}`, init);
    } catch {
      throw new ApiError(0, "Couldn't reach Open Brain");
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (res.status === 401) throw new AuthError(data?.error);
    if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
    return data;
  }

  const taskPath = (ref) => `/tasks/${encodeURIComponent(String(ref))}`;

  return {
    /** -> {today, tasks}: open tasks plus tasks completed on or after completedSince (YYYY-MM-DD). */
    listTasks: (completedSince) => request("GET", `/tasks?completed_since=${encodeURIComponent(completedSince)}`),
    /** -> [{tag, open_count}] */
    listTags: async () => (await request("GET", "/tags")).tags,
    /** fields: {title, tags, priority, due_date, recurrence, notes} -> task */
    createTask: async (fields) => (await request("POST", "/tasks", fields)).task,
    /** ref: short_id (42), "T-42", or UUID -> updated task */
    updateTask: async (ref, patch) => (await request("PATCH", taskPath(ref), patch)).task,
    /** -> undefined (the server answers 204) */
    deleteTask: async (ref) => {
      await request("DELETE", taskPath(ref));
    },
    /** -> {done, next}: next is the new occurrence of a recurring task, or null */
    completeTask: (ref) => request("POST", `${taskPath(ref)}/complete`),
  };
}
