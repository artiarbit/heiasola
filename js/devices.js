// Which Spotify device plays the music, and the connection status light.
// Polls Spotify's device list regularly; that also keeps the login fresh.

import { state, emit, saveDevice, toast } from './state.js';
import { spotify, explain, errorReason, notRegisteredMessage } from './spotify.js';
import { PERSONAL_DEVICE, TIMING } from './config.js';
import { idle } from './player.js';

let fails = 0;
let pollTimer = null;

export function schedulePoll(ms) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    if (state.tok && !document.hidden && !state.editorOpen) refreshDevices();
    else schedulePoll(TIMING.pollOk);
  }, ms);
}

/** One failed check is usually a hiccup: retry quickly, and only show red if it fails again. */
function softFail(message) {
  fails++;
  if (fails >= 2) emit('status', 'bad', message);
  else emit('status', 'warn', 'Checking Spotify again…');
  schedulePoll(fails >= 2 ? TIMING.pollFailing : TIMING.pollRetry);
}

const fromApi = d => ({ id: d.id, name: d.name, type: d.type, vol: d.volume_percent, canVol: !!d.supports_volume });

/** The saved device if Spotify still lists it; otherwise, on first use, this phone (never a speaker). */
function matchDevice(list) {
  const saved = state.device;
  if (saved) {
    return list.find(x => x.id === saved.id)
      || list.find(x => x.name === saved.name && x.type === saved.type);  // ids can change after a restart
  }
  const own = list.filter(x => PERSONAL_DEVICE.test(x.type));
  const phone = x => /smartphone/i.test(x.type);
  return own.find(x => phone(x) && x.is_active) || own.find(phone) || own.find(x => x.is_active) || own[0];
}

export async function refreshDevices() {
  clearTimeout(pollTimer);
  const t0 = performance.now();
  const r = await spotify.devices();
  emit('latency', performance.now() - t0, 'check');

  if (r.status === 403) {  // the account isn't allowed in the app (or isn't Premium): say so, don't retry fast
    const msg = /PREMIUM/i.test(errorReason(r)) ? 'This Spotify account needs Premium for remote control.' : notRegisteredMessage();
    emit('status', 'bad', msg);
    toast(msg);
    schedulePoll(TIMING.pollRefused);
    return;
  }
  if (!r.ok) {
    softFail(r.status === 0 ? 'No internet connection to Spotify'
      : r.status === 429 ? 'Spotify says slow down. Wait a few seconds.'
      : 'Could not reach Spotify (' + r.status + ')');
    return;
  }

  fails = 0;
  state.devices = r.json?.devices || [];
  const d = matchDevice(state.devices);
  if (d) {
    // While a clip fades, keep the volume we started from rather than the lowered one Spotify reports.
    const vol = (state.current || state.fading) && state.device ? state.device.vol : d.volume_percent;
    saveDevice({ ...fromApi(d), vol, chosen: !!state.device?.chosen });
    emit('status', 'ok', 'Ready · ' + d.name + (d.is_active ? '' : ' (idle)') + (state.ka.on ? ' · kept awake' : ''), !d.is_active);
    schedulePoll(TIMING.pollOk);
  } else {
    emit('status', 'warn',
      state.device ? state.device.name + ' has gone to sleep. Open Spotify on it and play any song for a second.'
      : state.devices.length ? 'Only speakers found. Open Spotify on this phone, or pick a speaker in Settings.'
      : 'No Spotify device found. Open Spotify on the phone, laptop or speaker you will play from.');
    schedulePoll(TIMING.pollMissing);  // look again soon so the light turns green as soon as Spotify is back
  }
  emit('devices');
}

/** The user picked a device in Settings. */
export function chooseDevice(d) {
  saveDevice({ ...fromApi(d), chosen: true });
  state.cue = null;
  emit('status', 'ok', 'Ready · ' + d.name);
  if (state.ka.on && !state.current) idle();
}

/** Makes the chosen device Spotify's active one. */
export async function makeActive({ quiet = false } = {}) {
  if (!state.device) { toast('Pick a device first.'); return; }
  const r = await spotify.transferTo(state.device.id);
  if (!r.ok) { toast(explain(r)); return; }
  if (!quiet) toast('Spotify is now set to play on ' + state.device.name + '.', 'info');
  if (state.ka.on) await idle();
  setTimeout(refreshDevices, 800);
}
