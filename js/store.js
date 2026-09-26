// Thin wrapper around localStorage. Everything is stored as JSON under the "gmr-" prefix.
// Keep the prefix: phones that already use the app have their buttons saved under it.

const PREFIX = 'gmr-';

export const store = {
  has(key) {
    try { return localStorage.getItem(PREFIX + key) !== null; } catch { return false; }
  },
  get(key, fallback) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  /** Returns false if the browser refused to save (e.g. private browsing). */
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
  },
  /** Saves and reads back, to be sure the browser really kept it. */
  setVerified(key, value) {
    const json = JSON.stringify(value);
    try {
      localStorage.setItem(PREFIX + key, json);
      return localStorage.getItem(PREFIX + key) === json;
    } catch { return false; }
  },
  del(key) {
    try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
  },
  key: k => PREFIX + k,
};
