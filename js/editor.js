// The "Edit button" sheet: choose a song, start/end times, fade, colour, Random, delete.
// Works on a copy of the button; nothing is saved until Save.

import { state, saveClips, toast } from './state.js';
import { spotify, explain, trackInfo } from './spotify.js';
import { playClip, idle, listenFrom, pauseListening, positionIn } from './player.js';
import { COLORS, TIMING } from './config.js';
import { $, el, fmtPrecise, fmtShort } from './dom.js';

let ed = null;  // { isNew, clip }

const endMs = c => c.start + c.dur * 1000;
const snap = ms => Math.round(ms / TIMING.stepMs) * TIMING.stepMs;
const toDur = ms => Math.round(ms / TIMING.stepMs) * TIMING.stepMs / 1000;

function newClip() {
  return {
    id: 'c' + Date.now().toString(36), name: '', color: COLORS[state.clips.length % COLORS.length],
    uri: '', trackName: '', artist: '', art: '', trackDur: 0, start: 0, dur: TIMING.newClipMs / 1000, fade: 2,
  };
}

export function openEditor(c) {
  state.editorOpen = true;
  ed = { isNew: !c, clip: c ? { ...c } : newClip() };
  $('edTitle').textContent = c ? 'Edit button' : 'New button';
  $('edName').value = ed.clip.name;
  $('edFade').value = ed.clip.fade;
  $('edRnd').checked = !ed.clip.noRandom;
  $('edRndField').hidden = !!ed.clip.special;
  $('edSearch').value = '';
  $('edResults').replaceChildren();
  renderDelete(c ? 'button' : 'none');
  $('fadeNote').hidden = !!state.device?.canVol;
  renderSwatches();
  render();
  $('edScrim').hidden = false;
  document.body.style.overflow = 'hidden';
  if (!c) setTimeout(() => $('edSearch').focus(), 60);
}

function closeEditor() {
  if (state.ka.on && !state.current) idle();
  state.editorOpen = false;
  ed = null;
  $('edScrim').hidden = true;
  document.body.style.overflow = '';
}

/* ---------- rendering ---------- */

function renderSwatches() {
  $('edColors').replaceChildren(...COLORS.map(col => {
    const s = el('button', 'sw');
    s.style.setProperty('--c', col);
    s.setAttribute('role', 'radio');
    s.setAttribute('aria-checked', ed.clip.color === col);
    s.setAttribute('aria-label', 'Colour ' + col);
    s.onclick = () => { ed.clip.color = col; renderSwatches(); };
    return s;
  }));
}

function render() {
  const c = ed.clip, has = !!c.uri;
  $('edChosen').hidden = !has;
  $('edFind').hidden = has;
  if (has) {
    $('edTrack').textContent = c.trackName;
    $('edArtist').textContent = c.artist + ' · ' + fmtShort(c.trackDur);
    $('edArt').src = c.art || '';
  }
  $('edStartBox').style.opacity = has ? 1 : 0.4;
  ['edListen', 'edMark', 'edMarkEnd', 'edPauseListen', 'edPreview', 'edPos', 'edEndPos'].forEach(id => { $(id).disabled = !has; });
  document.querySelectorAll('#edStartBox [data-n], #edStartBox [data-e]').forEach(b => { b.disabled = !has; });

  const songSec = Math.max(1, (c.trackDur || 1000) / 1000);
  $('edPos').max = Math.max(1, songSec - 1);
  $('edPos').value = c.start / 1000;
  $('edEndPos').max = songSec;
  $('edEndPos').value = endMs(c) / 1000;
  $('edStart').textContent = fmtPrecise(c.start);
  $('edLen').textContent = has ? 'song is ' + fmtShort(c.trackDur) + ' long' : '';
  $('edEnd').textContent = fmtPrecise(endMs(c));
  $('edClipLen').textContent = 'clip is ' + (+c.dur).toFixed(2).replace(/\.?0+$/, '') + ' s';
  $('edFadeO').textContent = c.fade + ' s';
}

/* ---------- start / end ---------- */

/** Moving the start keeps the end where it was, unless that would make the clip too short or too long. */
function setStart(ms) {
  const c = ed.clip, end = endMs(c), songMs = c.trackDur || 0;
  c.start = Math.max(0, Math.min(songMs - TIMING.minClipMs, snap(ms)));
  let e = end;
  if (e < c.start + TIMING.minClipMs || e > c.start + TIMING.maxClipMs) e = Math.min(songMs, c.start + TIMING.newClipMs);
  c.dur = Math.max(TIMING.minClipMs / 1000, toDur(e - c.start));
  render();
}

function setEnd(ms) {
  const c = ed.clip;
  const e = Math.max(c.start + TIMING.minClipMs, Math.min(c.trackDur || 0, c.start + TIMING.maxClipMs, snap(ms)));
  c.dur = toDur(e - c.start);
  render();
}

/* ---------- choosing a song ---------- */

function pickTrack(t) {
  const c = ed.clip;
  Object.assign(c, trackInfo(t), { start: 0 });
  if (!c.name) { c.name = t.name.replace(/\s*[-(].*$/, '').slice(0, 40); $('edName').value = c.name; }
  $('edResults').replaceChildren();
  render();
}

function resultRow(t) {
  const b = el('button', 'res');
  const img = el('img');
  const imgs = t.album?.images || [];
  img.src = (imgs[imgs.length - 1] || {}).url || '';
  img.alt = '';
  const text = el('span', 'rt');
  text.append(el('b', null, t.name), el('span', null, (t.artists || []).map(a => a.name).join(', ') + ' · ' + (t.album?.name || '')));
  b.append(img, text, el('span', 'rd', fmtShort(t.duration_ms)));
  b.onclick = () => pickTrack(t);
  return b;
}

let searchTimer, searchGen = 0;
async function onSearchInput(e) {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  const link = q.match(/track[/:]([A-Za-z0-9]{22})/);  // pasted Spotify song link or URI
  if (link) {
    const r = await spotify.track(link[1]);
    if (r.ok) pickTrack(r.json); else toast(explain(r));
    return;
  }
  if (q.length < 2) { $('edResults').replaceChildren(); return; }
  searchTimer = setTimeout(async () => {
    const my = ++searchGen;
    const r = await spotify.search(q);
    if (my !== searchGen || !ed) return;
    if (!r.ok) { toast(explain(r)); return; }
    const items = r.json?.tracks?.items || [];
    $('edResults').replaceChildren(...(items.length ? items.map(resultRow) : [el('p', 'small', 'No songs found.')]));
  }, 350);
}

/* ---------- delete / save ---------- */

function renderDelete(mode) {
  const w = $('delWrap');
  if (mode === 'none') { w.replaceChildren(); return; }
  if (mode === 'button') {
    const d = el('button', 'btn danger', 'Delete');
    d.onclick = () => renderDelete('confirm');
    w.replaceChildren(d);
    return;
  }
  const box = el('div', 'confirm', 'Delete this button? ');
  const yes = el('button', 'btn danger', 'Yes, delete');
  const no = el('button', 'btn', 'Keep');
  yes.onclick = () => {
    const id = ed.clip.id;
    state.clips = state.clips.filter(x => x.id !== id);
    closeEditor();
    saveClips();
  };
  no.onclick = () => renderDelete('button');
  box.append(yes, no);
  w.replaceChildren(box);
}

function save() {
  const c = ed.clip;
  if (!c.uri) { toast('Choose a song first.'); return; }
  c.name = (c.name || '').trim() || c.trackName.slice(0, 40);
  if (ed.isNew) state.clips.push(c);
  else {
    const i = state.clips.findIndex(x => x.id === c.id);
    if (i >= 0) state.clips[i] = c;
  }
  if (state.cue && state.cue.uri === c.uri && state.cue.pos !== c.start) state.cue = null;
  closeEditor();
  saveClips();
}

/* ---------- wiring ---------- */

export function initEditor() {
  $('edPos').addEventListener('input', e => setStart(e.target.value * 1000));
  $('edEndPos').addEventListener('input', e => setEnd(e.target.value * 1000));
  document.querySelectorAll('#edStartBox [data-n]').forEach(b => b.addEventListener('click', () => setStart(ed.clip.start + b.dataset.n * 1000)));
  document.querySelectorAll('#edStartBox [data-e]').forEach(b => b.addEventListener('click', () => setEnd(endMs(ed.clip) + b.dataset.e * 1000)));
  $('edFade').addEventListener('input', e => { ed.clip.fade = +e.target.value; render(); });
  $('edRnd').addEventListener('change', e => { if (e.target.checked) delete ed.clip.noRandom; else ed.clip.noRandom = true; });
  $('edName').addEventListener('input', e => { ed.clip.name = e.target.value; });
  $('edChange').addEventListener('click', () => { ed.clip.uri = ''; render(); $('edSearch').focus(); });
  $('edSearch').addEventListener('input', onSearchInput);

  $('edListen').addEventListener('click', () => listenFrom(ed.clip.uri, ed.clip.start));
  $('edPauseListen').addEventListener('click', pauseListening);
  $('edMark').addEventListener('click', async () => {
    const pos = await positionIn(ed.clip.uri);
    if (pos !== null && ed) setStart(pos);
  });
  $('edMarkEnd').addEventListener('click', async () => {
    const pos = await positionIn(ed.clip.uri);
    if (pos === null || !ed) return;
    if (pos <= ed.clip.start + TIMING.minClipMs) { toast('That is before the start point. Set the start first, or pick a later spot.'); return; }
    setEnd(pos);
  });
  $('edPreview').addEventListener('click', () => playClip({ ...ed.clip, id: '__preview' }));

  $('edCancel').addEventListener('click', closeEditor);
  $('edSave').addEventListener('click', save);
  // Tapping outside the sheet deliberately does nothing, so a new song can't be lost by a stray tap.
}
