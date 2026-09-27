// Main screen: header, buttons, now-playing bar, status chip and messages.

import { state, on, specialClips, pinnedClips, numberedClips } from './state.js';
import { $, el, fmtShort } from './dom.js';
import { playClip, playRandom, stopNow } from './player.js';
import { openEditor } from './editor.js';
import { openSettings } from './settings.js';

/* ---------- buttons ---------- */

/** Seconds badge: "7s", or "2:37" for long clips. */
function setSecs(node, seconds) {
  node.textContent = '';
  const t = Math.round(seconds);
  if (t >= 60) node.appendChild(el('b', null, Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0')));
  else { node.appendChild(el('b', null, String(t))); node.append('s'); }
}

function secsBadge(c) {
  const secs = el('span', 'secs');
  secs.dataset.dur = c.dur;
  setSecs(secs, c.dur);
  return secs;
}

function onPadTap(c) {
  if (state.editMode) openEditor(c); else playClip(c);
}

function specialPad(c) {
  const b = el('button', 'pad special');
  b.dataset.id = c.id;
  const top = el('span', 'top');
  top.append(state.editMode ? el('span', 'edit-tag', '✎ Edit') : el('span', 'tag', 'Heia Sola!'), secsBadge(c));
  b.append(el('span', 'name', c.name), top);
  if (!c.uri) {
    const foot = el('span', 'foot');
    foot.appendChild(el('span', 'tn', c.trackName || 'No song yet – tap Edit'));
    b.appendChild(foot);
  }
  b.appendChild(el('span', 'prog'));
  b.addEventListener('click', () => onPadTap(c));
  return b;
}

const PIN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M15 2.5 21.5 9l-2 1-3 3 .5 4.5-1.5 1.5-4-4-5 5H5v-1.5l5-5-4-4L7.5 8.5 12 9l3-3z"/></svg>';
function pinBadge() {
  const b = el('span', 'num pin');
  b.innerHTML = PIN_SVG;
  b.title = 'Pinned';
  return b;
}

/** i = position among the numbered buttons, or null for a pinned button. */
function regularPad(c, i) {
  const b = el('button', 'pad');
  b.dataset.id = c.id;
  b.style.setProperty('--c', c.color);

  const top = el('span', 'top');
  top.appendChild(i === null ? pinBadge() : el('span', 'num' + (i >= 9 ? ' two' : ''), String(i + 1)));
  if (state.editMode) top.appendChild(el('span', 'edit-tag', '✎ Edit'));
  else if (state.cue && state.cue.uri === c.uri && state.cue.pos === c.start) top.appendChild(el('span', 'cued', 'Ready'));
  top.appendChild(secsBadge(c));

  const foot = el('span', 'foot');
  if (c.art) {
    const img = el('img', 'art');
    img.src = c.art; img.alt = '';
    img.onerror = () => img.remove();
    foot.appendChild(img);
  }
  const info = el('span', 'info');
  info.appendChild(el('span', 'tn', c.uri ? (c.artist || c.trackName || '') : (c.trackName || 'No song yet – tap Edit')));
  if (c.uri) info.appendChild(el('span', 'rng', fmtShort(c.start) + ' – ' + fmtShort(c.start + c.dur * 1000) + (c.noRandom ? ' · not in Random' : '')));
  foot.appendChild(info);

  b.append(top, el('span', 'name', c.name || 'Untitled'), foot, el('span', 'prog'));
  b.addEventListener('click', () => onPadTap(c));
  return b;
}

function addPad() {
  const a = el('button', 'pad add');
  a.appendChild(el('span', 'name', '+ Add song'));
  a.addEventListener('click', () => openEditor(null));
  return a;
}

export function renderButtons() {
  $('specials').replaceChildren(...specialClips().map(specialPad));
  $('grid').replaceChildren(...pinnedClips().map(c => regularPad(c, null)), ...numberedClips().map((c, i) => regularPad(c, i)), addPad());
  renderPlaying();
}

function renderPlaying() {
  const cur = state.current;
  document.querySelectorAll('.pad[data-id]').forEach(p => {
    const on = cur && p.dataset.id === cur.id;
    const bar = p.querySelector('.prog');
    p.classList.toggle('playing', !!on);
    if (on && !p.dataset.anim) {  // progress bar runs along the bottom for the clip's length
      p.dataset.anim = '1';
      bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)';
      bar.getBoundingClientRect();
      bar.style.transition = 'transform ' + cur.dur + 's linear'; bar.style.transform = 'scaleX(1)';
    }
    if (!on) { delete p.dataset.anim; bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)'; }
  });
  $('nowT').textContent = cur ? cur.name : '–';
}

/* ---------- countdowns (button badge + Random button) ---------- */

let randomId = null;  // the button Random picked, while it's pending or playing

function secondsLeft() {
  const cur = state.current;
  return Math.max(0, Math.ceil(cur.dur - (performance.now() - cur.t0) / 1000));
}

function tick() {
  const cur = state.current;
  document.querySelectorAll('.pad[data-id] .secs').forEach(n => {
    if (cur && cur.id === n.closest('.pad').dataset.id) {
      const left = String(secondsLeft());
      if (n.dataset.show !== left) { n.dataset.show = left; setSecs(n, +left); }
    } else if (n.dataset.show) {
      delete n.dataset.show;
      setSecs(n, +n.dataset.dur);
    }
  });

  const randomPlaying = !!(randomId && cur && cur.id === randomId);
  if (!randomPlaying && randomId && !document.querySelector('.pad.busy')) randomId = null;
  const label = randomPlaying ? secondsLeft() + 's' : 'Random';
  if ($('rndLbl').textContent !== label) $('rndLbl').textContent = label;
  $('rndBtn').classList.toggle('playing', randomPlaying);
}

/* ---------- status, toast, screens ---------- */

function renderStatus(kind, text) {
  $('spotChip').className = 'chip spot ' + kind;
  $('spotTxt').textContent = kind === 'ok' ? 'Spotify connected' : /^Checking/.test(text) ? 'Checking Spotify…' : 'Spotify not connected';
  $('spotChip').title = text;
}

let toastTimer;
function showToast(text, kind) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast' + (kind === 'info' ? ' info' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'info' ? 3000 : 6000);
}

/** Shows the setup screen or the main screen depending on login. */
export function showScreen() {
  const loggedIn = !!state.tok;
  $('setup').hidden = loggedIn;
  ['main', 'hdrBtns', 'rndBtn', 'bar'].forEach(id => { $(id).hidden = !loggedIn; });
  if (loggedIn) renderButtons();
}

export function initUI() {
  on('clips', renderButtons);
  on('playing', renderPlaying);
  on('busy', (id, busy) => document.querySelector(`.pad[data-id="${id}"]`)?.classList.toggle('busy', busy));
  on('random', id => {
    randomId = id;
    const b = $('rndBtn');
    b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin');
  });
  on('status', renderStatus);
  on('devices', () => { $('nowLbl').textContent = state.device ? 'Plays on ' + state.device.name : 'Now playing'; });
  on('toast', showToast);

  $('rndBtn').addEventListener('click', playRandom);
  $('stopBtn').addEventListener('click', stopNow);
  $('setBtn').addEventListener('click', openSettings);
  $('spotChip').addEventListener('click', openSettings);
  $('editBtn').addEventListener('click', () => {
    state.editMode = !state.editMode;
    $('editBtn').setAttribute('aria-pressed', state.editMode);
    $('editBtn').textContent = state.editMode ? 'Done' : 'Edit';
    renderButtons();
  });

  // Keyboard (laptop): 1–9 play buttons, Space/Escape stop.
  document.addEventListener('keydown', e => {
    if (state.editorOpen || !$('setScrim').hidden || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); stopNow(); return; }
    const n = parseInt(e.key, 10), list = numberedClips();
    if (n >= 1 && n <= 9 && list[n - 1] && !state.editMode) playClip(list[n - 1]);
  });

  setInterval(tick, 200);
}
