// Shared app state plus a tiny event bus.
// Logic modules change `state` and emit events; ui.js / settings.js / editor.js listen and redraw.
//
// Events:
//   'auth'                 login state changed → show setup or main screen
//   'clips'                buttons changed → redraw the grid
//   'playing'              what's playing changed
//   'busy'   (id, on)      a button is waiting for Spotify
//   'random' (id)          the Random button picked this button
//   'status' (kind, text, canWake)   Spotify connection status: 'ok' | 'warn' | 'bad'
//   'devices'              device list or chosen device changed
//   'ka'                   keep-awake setting or silent track changed
//   'latency' (ms, what)   how long Spotify took to answer ('play' | 'check')
//   'toast'  (text, kind)  show a message; kind 'info' = neutral, otherwise error

import { store } from './store.js';
import { DEFAULT_CLIENT_ID, PERSONAL_DEVICE, SILENT_TRACK } from './config.js';
import { DEFAULT_CLIPS } from './defaults.js';

const listeners = new Map();
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(fn);
}
export function emit(event, ...args) {
  (listeners.get(event) || []).forEach(fn => fn(...args));
}
export const toast = (text, kind) => emit('toast', text, kind);

function loadDevice() {
  const d = store.get('device', null);
  // A speaker the app picked by itself (older versions did that) is forgotten; one the user chose is kept.
  if (d && !d.chosen && !PERSONAL_DEVICE.test(d.type || '')) { store.del('device'); return null; }
  return d;
}

function loadKeepAwake() {
  const ka = store.get('ka', { on: true, uri: '', name: '' });
  // Only ever use the configured silent track; forget any other track saved by older versions.
  if (!(ka.name || '').toLowerCase().startsWith(SILENT_TRACK.toLowerCase())) {
    ka.uri = ''; ka.name = ''; store.set('ka', ka);
  }
  return ka;
}

export const state = {
  clientId: store.get('clientId', '') || DEFAULT_CLIENT_ID,
  tok: store.get('tok', null),        // { access, refresh, exp }
  device: loadDevice(),               // { id, name, type, vol, canVol, chosen }
  devices: [],                        // latest list from Spotify
  clips: store.get('clips', []),      // the buttons (see CLAUDE.md → "Button data")
  ka: loadKeepAwake(),                // keep Spotify awake: { on, uri, name }
  current: null,                      // clip playing now: { id, name, dur, t0 }
  cue: null,                          // song paused at a button's start point: { uri, pos }
  fading: false,
  editMode: false,
  editorOpen: false,
};

export const regularClips = () => state.clips.filter(c => !c.special);
export const specialClips = () => state.clips.filter(c => c.special);

/** Saves the buttons, warns if the browser didn't keep them, and redraws. */
export function saveClips() {
  const ok = store.setVerified('clips', state.clips);
  if (!ok) toast('This browser did not save your buttons. Private browsing does not keep them. Open the app in a normal Safari tab or from the home-screen icon.');
  emit('clips');
  return ok;
}

export function setClips(list) {
  state.clips = list;
  state.cue = null;
  return saveClips();
}

export function loadDefaults() {
  return setClips(JSON.parse(JSON.stringify(DEFAULT_CLIPS)));
}

/** First run on this browser: start with the Heia Sola! defaults. */
export function ensureClips() {
  if (!store.has('clips')) loadDefaults();
}

export function saveDevice(d) {
  state.device = d;
  store.set('device', d);
  emit('devices');
}

export function saveKeepAwake() {
  store.set('ka', state.ka);
  emit('ka');
}
