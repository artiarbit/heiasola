// Playing clips: start, timed stop with optional fade, STOP, Random, and keep-awake.
//
// A clip = a Spotify song played from `start` (ms) for `dur` (s), then faded/paused.
// With keep-awake on, the silent track plays on repeat between clips so the Spotify app stays reachable.
// With it off, the song is paused at the button's start point afterwards ("cue"), so the next press
// of that button is a plain resume, which is the fastest thing Spotify can do.

import { state, emit, saveKeepAwake, regularClips, toast } from './state.js';
import { spotify, explain, errorReason, isGatewayError } from './spotify.js';
import { logPress, log } from './presslog.js';
import { fmtShort } from './dom.js';
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
  // Album form for the same reason as the clips: the single-song form leaves an iPhone stuck.
  const album = await albumUri(state.ka.uri);
  const r = album ? await send('silent track, as part of its album', () => spotify.playInAlbum(album, state.ka.uri, 0))
    : await send('silent track', () => spotify.play(state.ka.uri));
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

const NOT_STARTED = 'Spotify stopped the music but did not start the song. Open the Spotify app, play any song for a second, then try again.';

export async function playClip(c) {
  if (!c.uri) return;
  const my = ++generation;
  clearTimeout(stopTimer);
  cancelFade = true;
  logPress(c.name);
  emit('busy', c.id, true);
  const t0 = performance.now();
  const r = await startSong(c);
  emit('busy', c.id, false);
  if (my !== generation) return;
  emit('latency', performance.now() - t0, 'play');
  state.cue = null;
  // 502–504 means Spotify gave up waiting for the phone, but the phone often plays the song anyway.
  if (!r.ok && !isGatewayError(r)) return failed(explain(r));

  showPlaying(c, my);
  const seen = await confirmStarted(c, my);
  if (seen === null || seen === 'playing') return;

  // The phone isn't playing the song. If it has the song ready but paused, a plain resume is enough;
  // otherwise send the song again, from the start of the clip.
  const again = seen === 'ready' ? await send('resume', () => spotify.play()) : await playSong(c, { album: false });
  if (!stillOn(c, my)) return;
  if (!again.ok) return failed(explain(again));
  showPlaying(c, my);
  const last = await confirmStarted(c, my);
  if (last === null || last === 'playing') return;
  failed(NOT_STARTED);
  logDeviceList();
}

/** Sends a command and logs what Spotify answered. */
async function send(what, command) {
  const r = await command();
  log(what + ' → ' + (r.ok ? 'OK' : r.status === 0 ? 'no answer' : r.status + ' ' + errorReason(r)).trim());
  return r;
}

/*
 * Two forms of "play this song": the song on its own, or its album starting at the song (what the
 * Spotify app does on a tap). On Ørjan's iPhone the single-song form left the player empty ("no song",
 * everything blocked) while the album form played. So the album form goes first and the single-song
 * form is the second try. Album ids are looked up once per song and kept in memory.
 */
const albumOf = new Map();
async function albumUri(uri) {
  if (!albumOf.has(uri)) {
    const t = await spotify.track(uri.split(':').pop());
    if (!t.ok) return null;  // try again next time
    albumOf.set(uri, t.json?.album?.uri || null);
  }
  return albumOf.get(uri);
}

/** Looks up the albums of all buttons in the background, so the first press doesn't wait for it. */
export async function prefetchAlbums() {
  for (const c of state.clips.filter(x => x.uri && !albumOf.has(x.uri))) {
    if (!state.tok) return;
    await albumUri(c.uri);
  }
  if (state.ka.uri) await albumUri(state.ka.uri);
}

async function playSong(c, { album, ...opts }) {
  const albumId = album && await albumUri(c.uri);
  if (albumId) return send('play from ' + fmtShort(c.start) + ', as part of its album', () => spotify.playInAlbum(albumId, c.uri, c.start, opts));
  return send('play from ' + fmtShort(c.start) + (album ? '' : ', song on its own'), () => spotify.play(c.uri, c.start, opts));
}

/** Sends the play command: a plain resume if the song is already waiting at the start point. */
async function startSong(c) {
  if (state.cue && state.cue.uri === c.uri && state.cue.pos === c.start) {
    const r = await send('resume (song was ready)', () => spotify.play());
    if (r.ok) return r;
  }
  // No automatic second try on 502–504 here: two commands right after each other can leave the
  // phone stopped. confirmStarted() looks at what the phone is doing first, and only then asks again.
  return playSong(c, { album: true, retryGateway: false });
}

/** Marks the clip as playing and (re)starts its countdown and timed stop. */
function showPlaying(c, my) {
  clearTimeout(stopTimer);
  if (state.current) { state.current = null; emit('playing'); }  // so a second try restarts the progress bar
  state.current = { id: c.id, name: c.name, dur: c.dur, t0: performance.now() };
  emit('playing');
  const fadeMs = canFade(c) ? c.fade * 1000 : 0;
  stopTimer = setTimeout(() => endClip(c, my), c.dur * 1000 + TIMING.startLagMs - fadeMs);
}

function failed(message) {
  clearTimeout(stopTimer);
  state.current = null;
  emit('playing');
  toast(message);
  log('gave up, showed a message');
}

/** This clip is still the thing playing: no newer press, no STOP, and its end hasn't started. */
const stillOn = (c, my) => my === generation && state.current?.id === c.id && !state.fading;

const norm = s => (s || '').toLowerCase().trim();
/**
 * The song on the phone is this button's song. Spotify sometimes plays another copy of the same song
 * (another id, same name; e.g. a version licensed for your country) and since Feb 2026 no longer says
 * which id it replaced, so a matching name counts too.
 */
const isOurSong = (item, c) => !!item && (item.uri === c.uri || (!!c.trackName && norm(item.name) === norm(c.trackName)));

/** What the phone is doing for this clip: 'playing', 'ready' (our song paused near its start), 'other', or null if Spotify didn't say. */
function phoneState(r, c) {
  if (r.status === 204) return 'other';  // nothing playing at all
  if (!r.ok || !r.json) return null;
  const p = r.json;
  if (!isOurSong(p.item, c)) return 'other';
  if (p.is_playing) return 'playing';
  return Math.abs((p.progress_ms || 0) - c.start) < 5000 ? 'ready' : 'other';
}

/** One log line with what Spotify says the phone is doing. */
function describePlayer(r, c) {
  if (r.status === 204) return 'phone: nothing playing';
  if (!r.ok || !r.json) return 'phone: no answer (' + r.status + ')';
  const p = r.json, it = p.item, d = p.device;
  const song = !it ? 'no song' : it.uri === c.uri ? 'our song' : isOurSong(it, c) ? 'our song (other copy)' : '“' + it.name + '”';
  const blocked = Object.keys(p.actions?.disallows || {}).filter(k => p.actions.disallows[k]);
  return ['phone:', song, p.is_playing ? 'PLAYING' : 'paused', 'at ' + fmtShort(p.progress_ms),
    d ? '· on ' + d.name + (d.id === state.device?.id ? '' : ' (not the chosen device)') : '· no device',
    p.context ? '· from ' + p.context.type : '', p.shuffle_state ? '· shuffle' : '', p.smart_shuffle ? '· smart shuffle' : '',
    blocked.length ? '· blocked: ' + blocked.join(',') : ''].filter(Boolean).join(' ');
}

/**
 * Spotify sometimes accepts a play command and the phone still doesn't start the song: it stops what
 * was playing and goes quiet. Seen on iPhones when other music was playing. So look what the phone is
 * doing (Spotify's report lags a little, hence a second look before giving up).
 * Returns 'playing', 'ready', 'other', or null (can't tell, or the clip is no longer current).
 */
async function confirmStarted(c, my) {
  let seen = 'other';
  for (const wait of TIMING.confirmWaits) {
    await sleep(wait);
    if (!stillOn(c, my)) return null;
    const r = await spotify.player();
    if (!stillOn(c, my)) return null;
    log(describePlayer(r, c));
    seen = phoneState(r, c);
    if (seen === null || seen === 'playing') return seen;
  }
  return seen;
}

/** After giving up: is the chosen device still in Spotify's list (or has its Spotify app gone to sleep)? */
async function logDeviceList() {
  const r = await spotify.devices();
  if (!r.ok) { log('device list: no answer (' + r.status + ')'); return; }
  const list = r.json?.devices || [];
  const d = list.find(x => x.id === state.device?.id);
  log(d ? 'device list: ' + d.name + (d.is_active ? ' is active' : ' is listed but not active')
    : 'device list: ' + (state.device?.name || 'chosen device') + ' is missing (' + (list.map(x => x.name).join(', ') || 'no devices') + ')');
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
  logPress('STOP');
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

/* ---------- halftime and timeout music ---------- */

export const HALFTIME_ID = '__halftime';

/**
 * Plays the chosen playlist from a random song and lets it run until STOP. Spotify no longer lets this
 * app read the songs of other people's playlists (Feb 2026), so the app starts the playlist itself:
 * at a random position when the size is known, otherwise with shuffle on. Playing a playlist is the
 * same "context" form as the album form, which works on iPhones.
 */
export async function playHalftime() {
  const pl = state.halftime;
  if (!pl?.uri) { toast('Choose a playlist for halftime music under ⚙︎ Settings.', 'info'); return false; }
  const my = ++generation;
  clearTimeout(stopTimer);
  cancelFade = true;
  state.cue = null;
  logPress('Halftime music');
  emit('busy', HALFTIME_ID, true);
  const offset = pl.total > 0 ? { position: Math.floor(Math.random() * pl.total) } : null;
  await send('shuffle on', () => spotify.shuffle(true));
  const r = await send('play “' + pl.name + '”' + (offset ? ' from song ' + (offset.position + 1) + ' of ' + pl.total : ', shuffled'),
    () => spotify.playContext(pl.uri, offset));
  emit('busy', HALFTIME_ID, false);
  if (my !== generation) return true;
  if (!r.ok) { failed(explain(r)); return true; }
  state.current = { id: HALFTIME_ID, name: 'Halftime music', dur: null, t0: performance.now() };
  emit('playing');
  send('repeat off (keep-awake had set repeat one song)', () => spotify.repeat('context'));
  return true;
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

/**
 * "Play song" in the editor: plays from `ms` to the end of the song through the same path as a button,
 * so it gets the same iPhone handling (album form, check that it started, second try) and log lines.
 */
export function listenFrom(clip, ms) {
  state.cue = null;
  const left = Math.max(1, ((clip.trackDur || ms + 600000) - ms) / 1000);
  return playClip({ ...clip, id: '__listen', name: 'Edit: play song', start: ms, dur: left, fade: 0 });
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
