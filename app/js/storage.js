// localStorage can throw (private mode, blocked storage); callers then keep state in memory only.
export const storage = {
  get: (k) => {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set: (k, v) => {
    try { localStorage.setItem(k, v); } catch { /* memory only */ }
  },
  remove: (k) => {
    try { localStorage.removeItem(k); } catch { /* nothing stored */ }
  },
};
