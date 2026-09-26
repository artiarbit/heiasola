// Entry point: wires up the screens and starts the app.

import { state, on, emit, ensureClips } from './state.js';
import { store } from './store.js';
import { finishLogin } from './spotify.js';
import { refreshDevices } from './devices.js';
import { resolveSilent } from './player.js';
import { initUI, showScreen } from './ui.js';
import { initEditor } from './editor.js';
import { initSettings } from './settings.js';
import { initSetup, showSetupError } from './setup.js';

/** Keeps the phone screen on while the app is open (where the browser allows it). */
function keepScreenOn() {
  let lock = null;
  const request = async () => {
    if (lock || document.hidden || !('wakeLock' in navigator)) return;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } catch { /* not allowed yet; tried again on the next tap */ }
  };
  request();
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, request, { passive: true }));
  document.addEventListener('visibilitychange', request);
}

/** If the app is open in two tabs, pick up buttons saved in the other one instead of overwriting them later. */
function syncAcrossTabs() {
  window.addEventListener('storage', e => {
    if (e.key !== store.key('clips') || !e.newValue || state.editorOpen) return;
    try { state.clips = JSON.parse(e.newValue); emit('clips'); } catch { /* ignore */ }
  });
}

function onLoginChange() {
  showScreen();
  if (!state.tok) return;
  ensureClips();
  refreshDevices();
  resolveSilent();
}

async function start() {
  initUI();
  initEditor();
  initSettings();
  initSetup();
  keepScreenOn();
  syncAcrossTabs();

  on('auth', onLoginChange);
  window.addEventListener('online', () => { if (state.tok) refreshDevices(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.tok) refreshDevices(); });

  showSetupError(await finishLogin());
  onLoginChange();
  emit('devices');
}

start();
