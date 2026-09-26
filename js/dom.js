// DOM and formatting helpers shared by all screens. No app logic here.

import { toast } from './state.js';

export const $ = id => document.getElementById(id);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** 61600 → "1:01.60" (editor) */
export function fmtPrecise(ms) {
  const s = Math.max(0, (ms || 0) / 1000), m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2);
}
/** 61600 → "1:02" */
export function fmtShort(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export async function copyText(text, doneMessage) {
  try { await navigator.clipboard.writeText(text); if (doneMessage) toast(doneMessage, 'info'); return true; } catch { return false; }
}

