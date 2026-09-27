// Online storage: each person's buttons follow their Spotify account, and "Share with everyone".
// Talks to the Supabase Edge Function in supabase/functions/heiasola. Off when CLOUD_URL is empty.
//
// How it stays in step:
//  - On login and whenever the app comes back to the screen, the list is fetched ("sync").
//    The online list replaces the phone's copy, unless the phone has changes that never got
//    uploaded ("dirty"), in which case the phone's copy wins and is uploaded.
//  - Every save on the phone is uploaded a moment later. If that fails (no network), the phone
//    remembers it's dirty and tries again later.
//  - Songs others shared since the last sync are added to the end of the list (skipping songs
//    already on it), with a short message.
//  - Two phones editing at the same time: the last one to save wins.

import { state, on, emit, setClips, toast } from './state.js';
import { store } from './store.js';
import { freshToken } from './spotify.js';
import { CLOUD_URL } from './config.js';

const cloudUrl = () => store.get('cloudUrl', '') || CLOUD_URL;  // 'cloudUrl' override is for tests
export const cloudEnabled = () => !!cloudUrl();

export const cloud = {
  status: 'off',   // 'off' | 'syncing' | 'ok' | 'offline' | 'error'
  text: '',
  user: null,      // { id, name } from Spotify, via the backend
};

let ready = false;      // don't upload until the first sync has decided which list is right
let applying = false;   // true while we're saving a list that came from online (no need to upload it)
let pushTimer = null;
let syncing = null;

function setStatus(status, text) {
  cloud.status = status;
  cloud.text = text;
  emit('cloud');
}

async function call(method, body) {
  const token = await freshToken();
  if (!token) return { ok: false, status: 401, json: null };
  try {
    const r = await fetch(cloudUrl(), {
      method,
      headers: { 'x-spotify-token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

const timeNow = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Adds songs others shared since `seen` that aren't on the list yet. */
function mergeShared(clips, sharedRows, seen) {
  const added = [];
  let newest = seen;
  for (const row of sharedRows || []) {
    if (row.id <= seen) continue;
    newest = Math.max(newest, row.id);
    if (clips.some(c => c.uri === row.clip.uri) || added.some(c => c.uri === row.clip.uri)) continue;
    added.push({ ...row.clip, id: 'sh' + row.id, sharedBy: row.shared_by_name || 'someone' });
  }
  return { clips: [...clips, ...added], added, newest };
}

function describeAdded(added) {
  if (!added.length) return '';
  if (added.length === 1) return `New song from ${added[0].sharedBy}: ${added[0].name}`;
  return `${added.length} new songs shared by others were added at the end of your list.`;
}

export function sync() {
  if (!cloudEnabled() || !state.tok) return Promise.resolve();
  syncing ||= (async () => {
    setStatus('syncing', 'Checking your online buttons…');
    const r = await call('GET');
    if (!r.ok) {
      ready = true;  // local edits from now on are kept and marked dirty
      setStatus(r.status === 0 ? 'offline' : 'error',
        r.status === 0 ? 'No connection to the online storage. Using the buttons saved on this phone.'
                       : 'Online storage error (' + r.status + '). Using the buttons saved on this phone.');
      return;
    }
    cloud.user = r.json.user;
    const saved = r.json.list;
    const dirty = store.get('cloudDirty', false);
    const base = saved && !dirty ? saved.clips : state.clips;
    const seen = saved ? Number(saved.shared_seen) || 0 : 0;
    const { clips, added, newest } = mergeShared(base, r.json.shared, seen);

    applying = true;
    setClips(clips);
    applying = false;
    store.set('cloudSeen', newest);
    ready = true;

    if (!saved || dirty || added.length || newest !== seen) await push();
    else setStatus('ok', 'Saved online · checked ' + timeNow());
    if (added.length) toast(describeAdded(added), 'info');
  })().finally(() => { syncing = null; });
  return syncing;
}

async function push() {
  clearTimeout(pushTimer);
  const r = await call('PUT', { clips: state.clips, sharedSeen: store.get('cloudSeen', 0) });
  if (r.ok) {
    store.set('cloudDirty', false);
    setStatus('ok', 'Saved online · ' + timeNow());
  } else {
    store.set('cloudDirty', true);
    setStatus(r.status === 0 ? 'offline' : 'error',
      'Saved on this phone. Will save online when the connection is back.');
  }
}

function schedulePush() {
  if (!cloudEnabled() || !state.tok || applying || !ready) return;
  store.set('cloudDirty', true);  // until the upload succeeds
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 800);
}

/** "Share with everyone": others get this song (with its timing) next time they open the app. */
export async function shareClip(c) {
  const r = await call('POST', { clip: c });
  if (!r.ok) {
    toast(r.status === 0 ? 'No connection. Try sharing again when you are online.' : (r.json?.error || 'Could not share the song.'));
    return null;
  }
  return r.json.shared;
}

export function initCloud() {
  if (!cloudEnabled()) { setStatus('off', ''); return; }
  on('saved', schedulePush);
  on('auth', () => { ready = false; cloud.user = null; if (!state.tok) setStatus('off', ''); });  // main.js calls sync() after login
  window.addEventListener('online', () => { if (state.tok) (store.get('cloudDirty', false) && ready ? push() : sync()); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.tok && !state.editorOpen) sync(); });
}
