// Playing clips: start, timed stop with optional fade, STOP, Random, and keep-awake.
//
// A clip = a Spotify song played from `start` (ms) for `dur` (s), then faded/paused.
// With keep-awake on, the silent track plays on repeat between clips so the Spotify app stays reachable.
// With it off, the song is paused at the button's start point afterwards ("cue"), so the next press
// of that button is a plain resume, which is the fastest thing Spotify can do.

import { state, emit, saveKeepAwake, regularClips, toast } from './state.js';
import { spotify, explain } from './spotify.js';
import { SILENT_TRACK, TIMING } from './config.js';

let stopTimer = null;
let generation = 0;     // bumps on every new action; older async steps check it and give up
let cancelFade = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const canFade = c => c.fade > 0 && state.device?.canVol && typeof state.device.vol === 'number';

/* ---------- keep Spotify awake ---------- */

let resolving = null;
export const isResolvingSilent = () => !!resolving;

/** Finds the silent track on Spotify once, then remembers it. */
export function resolveSilent() {
  if (state.ka.uri) return Promise.resolve(true);
  resolving ||= (async () => {
    const r = await spotify.search('"' + SILENT_TRACK + '"');
    const items = (r.ok && r.json?.tracks?.items) || [];
    const norm = x => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const want = norm(SILENT_TRACK);
    const t = items.find(t => norm(t.name) === want && t.duration_ms >= 540000 && t.duration_ms <= 660000)
      || items.find(t => norm(t.name) === want)
      || items.find(t => norm(t.name).startsWith(want));
    if (t) { state.ka.uri = t.uri; state.ka.name = t.name; }
    resolving = null;
    saveKeepAwake();
    return !!state.ka.uri;
  })();
  return resolving;
}

/** What Spotify does between goals. Returns true if the silent track is now playing. */
export async function idle() {
  if (!state.ka.on) return false;
  if (!state.ka.uri && !(await resolveSilent())) return false;
  const r = await spotify.play(state.ka.uri);
  if (!r.ok) return false;
  spotify.repeatTrack();
  return true;
}

export function setKeepAwake(on) {
  state.ka.on = on;
  state.cue = null;
  saveKeepAwake();
  emit('clips');
  if (state.current) return;
  if (on) idle(); else spotify.pause();
}

/* ---------- clips ---------- */

export async function playClip(c) {
  if (!c.uri) return;
  const my = ++generation;
  clearTimeout(stopTimer);
  cancelFade = true;
  emit('busy', c.id, true);
  const t0 = performance.now();

  let r = null;
  if (state.cue && state.cue.uri === c.uri && state.cue.pos === c.start) {
    r = await spotify.play();          // already paused at the right spot: plain resume
    if (!r.ok) r = null;
  }
  r ||= await spotify.play(c.uri, c.start);

  emit('busy', c.id, false);
  if (my !== generation) return;
  emit('latency', performance.now() - t0, 'play');
  state.cue = null;
  if (!r.ok) { toast(explain(r)); state.current = null; emit('playing'); return; }

  state.current = { id: c.id, name: c.name, dur: c.dur, t0: performance.now() };
  emit('playing');
  const fadeMs = canFade(c) ? c.fade * 1000 : 0;
  stopTimer = setTimeout(() => endClip(c, my), c.dur * 1000 + TIMING.startLagMs - fadeMs);
}

async function endClip(c, my) {
  cancelFade = false;
  state.fading = true;
  try {
    if (canFade(c)) {
      const v0 = state.device.vol;
      for (let i = 1; i <= TIMING.fadeSteps; i++) {
        if (cancelFade || my !== generation) return;
        await spotify.volume(v0 * (1 - i / TIMING.fadeSteps));
        await sleep(c.fade * 1000 / TIMING.fadeSteps);
      }
      if (my !== generation) return;
      if (!(await idle())) await spotify.pause();
      await spotify.volume(v0);
    } else if (!(await idle())) {
      await spotify.pause();
    }
    if (my !== generation) return;
    state.current = null;
    emit('playing');
    if (!state.ka.on) recue(c, my);
  } finally {
    state.fading = false;
  }
}

/** Leaves the song paused at the button's start point, so the next press is a quick resume. */
async function recue(c, my) {
  const r = await spotify.seek(c.start);
  if (r.ok && my === generation) { state.cue = { uri: c.uri, pos: c.start }; emit('clips'); }
}

export async function stopNow() {
  const my = ++generation;
  clearTimeout(stopTimer);
  cancelFade = true;
  const was = state.current && state.clips.find(x => x.id === state.current.id);
  state.current = null;
  emit('playing');
  if (!(await idle())) {
    const r = await spotify.pause();
    if (!r.ok && r.status !== 403) toast(explain(r));
  }
  if (state.device?.canVol && typeof state.device.vol === 'number') spotify.volume(state.device.vol);
  if (was && !state.ka.on) recue(was, my);
}

/* ---------- Random ---------- */

let lastRandom = null;
/** Plays a random numbered button (not specials, not ones left out of Random), never the same twice in a row. */
export function playRandom() {
  const pool = regularClips().filter(c => c.uri && !c.noRandom);
  if (!pool.length) { toast('No songs are included in Random. Turn it on for a song under Edit.'); return; }
  const pick = pool.length > 1 ? pool.filter(c => c.id !== lastRandom) : pool;
  const c = pick[Math.floor(Math.random() * pick.length)];
  lastRandom = c.id;
  emit('random', c.id);
  playClip(c);
}

/* ---------- listening in the editor ---------- */

export async function listenFrom(uri, ms) {
  ++generation;
  clearTimeout(stopTimer);
  state.current = null;
  state.cue = null;
  emit('playing');
  const r = await spotify.play(uri, ms);
  if (!r.ok) toast(explain(r));
}

export function pauseListening() {
  ++generation;
  clearTimeout(stopTimer);
  spotify.pause();
}

/** Where Spotify is in `uri` right now (ms), or null with a message if it isn't playing that song. */
export async function positionIn(uri) {
  const t0 = performance.now();
  const r = await spotify.nowPlaying();
  if (!r.ok || !r.json?.item) { toast('Nothing is playing. Press Play song first.'); return null; }
  if (r.json.item.uri !== uri) { toast('Spotify is playing a different song. Press Play song first.'); return null; }
  // Spotify reports the position when it answered; add half the round trip so the mark matches the tap.
  let pos = r.json.progress_ms;
  if (r.json.is_playing) pos += Math.round((performance.now() - t0) / 2);
  return pos;
}
