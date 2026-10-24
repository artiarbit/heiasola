// A short log of the last few presses: what the app sent and what Spotify said the phone was doing.
// Shown in Settings ("What Spotify said") so a problem on a real phone can be read off a screenshot.
// Memory only: it is gone after a reload, and nothing is sent anywhere.

import { emit } from './state.js';

const KEEP = 5;          // presses kept
const presses = [];      // newest last: { head, lines: [] }
let t0 = 0;

const two = n => String(n).padStart(2, '0');
const clock = d => two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());

/** Starts a new entry for a press (a button, Random, STOP). */
export function logPress(what) {
  t0 = performance.now();
  presses.push({ head: clock(new Date()) + '  ' + what, lines: [] });
  if (presses.length > KEEP) presses.shift();
  emit('presslog');
}

/** Adds a line to the latest press, with the seconds since it was pressed. */
export function log(text) {
  const p = presses[presses.length - 1];
  if (!p) return;
  p.lines.push('+' + ((performance.now() - t0) / 1000).toFixed(1) + 's  ' + text);
  emit('presslog');
}

/** The log as text, newest press first (so a screenshot shows the latest one). */
export function pressLogText() {
  return [...presses].reverse().map(p => [p.head, ...p.lines.map(l => '  ' + l)].join('\n')).join('\n\n');
}
