// The Settings sheet (⚙︎): status, device, keep-awake, backup, reset to defaults, log out.

import { state, on, setClips, loadDefaults, toast } from './state.js';
import { logout, usingDefaultApp } from './spotify.js';
import { refreshDevices, chooseDevice, makeActive } from './devices.js';
import { resolveSilent, isResolvingSilent, setKeepAwake } from './player.js';
import { SILENT_TRACK, OWNER } from './config.js';
import { $, el, copyText } from './dom.js';
import { cloud, cloudEnabled, sync } from './cloud.js';

export function openSettings() {
  $('whichApp').textContent = usingDefaultApp() ? `Connected through ${OWNER}'s app.` : 'Connected through your own Spotify app.';
  renderKeepAwake();
  if (!state.ka.uri) resolveSilent();
  $('backup').value = JSON.stringify(state.clips);
  renderReset('button');
  renderDevices();
  renderCloud();
  if (cloudEnabled() && cloud.status !== 'syncing') sync();
  $('setScrim').hidden = false;
  refreshDevices();
}

const closeSettings = () => { $('setScrim').hidden = true; };

function renderDevices() {
  const list = state.devices;
  if (!list.length) { $('devs').replaceChildren(el('p', 'small', 'No devices right now.')); return; }
  $('devs').replaceChildren(...list.map(d => {
    const b = el('button', 'dev');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', state.device?.id === d.id);
    b.append(el('span', null, d.name), el('small', null, d.type + (d.is_active ? ' · active' : '') + (d.supports_volume ? '' : ' · no fade')));
    b.onclick = () => chooseDevice(d);
    return b;
  }));
}

function renderStatus(kind, text, canWake) {
  $('status').className = 'status ' + kind;
  $('statusTxt').textContent = text;
  $('statusWake').hidden = !(kind === 'ok' && canWake);
}

const CLOUD_LIGHT = { ok: 'ok', syncing: 'warn', offline: 'warn', error: 'bad', off: '' };
function renderCloud() {
  $('cloudField').hidden = !cloudEnabled();
  if (!cloudEnabled()) return;
  $('cloudUser').textContent = cloud.user ? 'Logged in to Spotify as ' + cloud.user.name + '.' : '';
  $('cloudStatus').className = 'status ' + CLOUD_LIGHT[cloud.status];
  $('cloudTxt').textContent = cloud.text || '…';
}

function renderKeepAwake() {
  const ka = state.ka;
  $('kaBtn').setAttribute('aria-pressed', !!ka.on);
  $('kaBtn').textContent = ka.on ? 'On' : 'Off';
  $('kaTrack').textContent = ka.uri ? `Plays “${ka.name}” between goals`
    : isResolvingSilent() ? `Looking up “${SILENT_TRACK}”…`
    : `Could not find “${SILENT_TRACK}” on Spotify yet`;
}

function renderReset(mode) {
  const w = $('resetWrap');
  if (mode === 'button') {
    const b = el('button', 'btn', 'Reset to Heia Sola! defaults');
    b.onclick = () => renderReset('confirm');
    w.replaceChildren(b);
    return;
  }
  const box = el('div', 'confirm', 'Replace all your buttons? ');
  const yes = el('button', 'btn danger', 'Yes, reset');
  const no = el('button', 'btn', 'Cancel');
  yes.onclick = () => {
    loadDefaults();
    $('backup').value = JSON.stringify(state.clips);
    renderReset('button');
    toast('Buttons reset to the Heia Sola! defaults.', 'info');
  };
  no.onclick = () => renderReset('button');
  box.append(yes, no);
  w.replaceChildren(box);
}

function loadBackup() {
  try {
    const list = JSON.parse($('backup').value);
    if (!Array.isArray(list) || list.some(x => !x.uri)) throw new Error('invalid');
    setClips(list);
    toast('Loaded ' + list.length + ' buttons.', 'info');
    closeSettings();
  } catch {
    toast('That text is not a valid backup.');
  }
}

export function initSettings() {
  on('devices', renderDevices);
  on('status', renderStatus);
  on('latency', (ms, what) => { $('latency').textContent = (what === 'play' ? 'Last press: ' : 'Spotify responds in ') + Math.round(ms) + ' ms'; });
  on('ka', renderKeepAwake);
  on('cloud', renderCloud);

  $('setClose').addEventListener('click', closeSettings);
  $('setScrim').addEventListener('click', e => { if (e.target === $('setScrim')) closeSettings(); });
  $('devRefresh').addEventListener('click', refreshDevices);
  $('devWake').addEventListener('click', () => makeActive());
  $('statusWake').addEventListener('click', () => makeActive({ quiet: true }));
  $('kaBtn').addEventListener('click', () => setKeepAwake(!state.ka.on));
  $('copyBackup').addEventListener('click', async () => { if (!(await copyText($('backup').value, 'Copied.'))) $('backup').select(); });
  $('loadBackup').addEventListener('click', loadBackup);
  $('logout').addEventListener('click', () => { closeSettings(); logout(); });
}
