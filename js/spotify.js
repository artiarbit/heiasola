// Spotify login (PKCE, no server needed) and Web API calls.
// api() never throws: a network failure comes back as { ok: false, status: 0 }.

import { state, emit } from './state.js';
import { store } from './store.js';
import { DEFAULT_CLIENT_ID, SCOPES, REDIRECT_URI, OWNER } from './config.js';

const API = 'https://api.spotify.com/v1';
const ACCOUNTS = 'https://accounts.spotify.com';

/* ---------- login ---------- */

function b64url(bytes) {
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Sends the browser to Spotify's login page. Returns an error message if the Client ID looks wrong. */
export async function startLogin(clientId) {
  if (!/^[0-9a-f]{32}$/i.test(clientId)) return 'That does not look like a Client ID. It is 32 letters and numbers.';
  state.clientId = clientId;
  store.set('clientId', clientId);
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const stateToken = b64url(crypto.getRandomValues(new Uint8Array(12)));
  store.set('verifier', verifier);
  store.set('state', stateToken);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  location.href = ACCOUNTS + '/authorize?' + new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state: stateToken,
  });
  return null;
}

/** Handles the return from Spotify's login page. Returns an error message, or null. */
export async function finishLogin() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  history.replaceState(null, '', REDIRECT_URI);
  try {
    if (q.get('error')) return 'Spotify said: ' + q.get('error');
    if (q.get('state') !== store.get('state', '')) return 'Login did not match. Try again.';
    await tokenRequest({
      grant_type: 'authorization_code', code: q.get('code'), redirect_uri: REDIRECT_URI,
      client_id: state.clientId, code_verifier: store.get('verifier', ''),
    });
    return null;
  } catch (e) {
    return 'Login failed: ' + e.message + '. Check that the redirect address in the Spotify dashboard matches exactly.';
  } finally {
    store.del('verifier');
    store.del('state');
  }
}

async function tokenRequest(params) {
  const r = await fetch(ACCOUNTS + '/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || ('HTTP ' + r.status));
  state.tok = {
    access: j.access_token,
    refresh: j.refresh_token || state.tok?.refresh,
    exp: Date.now() + (j.expires_in || 3600) * 1000,
  };
  store.set('tok', state.tok);
}

let refreshing = null;
function refreshToken() {
  if (!state.tok?.refresh) return Promise.reject(new Error('not logged in'));
  refreshing ||= tokenRequest({ grant_type: 'refresh_token', refresh_token: state.tok.refresh, client_id: state.clientId })
    .finally(() => { refreshing = null; });
  return refreshing;
}

export function logout() {
  state.tok = null;
  store.del('tok');
  emit('auth');
}

export const usingDefaultApp = () => state.clientId === DEFAULT_CLIENT_ID;

/* ---------- Web API ---------- */

/** A Spotify access token that is valid for at least another minute, or null if logged out. */
export async function freshToken() {
  if (!state.tok) return null;
  if (Date.now() > state.tok.exp - 60000) {
    try { await refreshToken(); } catch { logout(); return null; }
  }
  return state.tok.access;
}

export async function api(method, path, body) {
  if (!(await freshToken())) return { ok: false, status: 401, json: null };
  try {
    const send = () => fetch(API + path, {
      method,
      headers: { Authorization: 'Bearer ' + state.tok.access, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let r = await send();
    if (r.status === 401) { await refreshToken(); r = await send(); }
    const json = r.status === 204 ? null : await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

/** Adds the chosen device to a player path, so commands go to that device. */
function withDevice(path) {
  if (!state.device?.id) return path;
  return path + (path.includes('?') ? '&' : '?') + 'device_id=' + encodeURIComponent(state.device.id);
}

export const spotify = {
  devices: () => api('GET', '/me/player/devices'),
  /** play(uri, ms) starts a song at a position; play() with no song resumes. */
  play: (uri, positionMs) => api('PUT', withDevice('/me/player/play'),
    uri ? { uris: [uri], ...(positionMs != null ? { position_ms: Math.round(positionMs) } : {}) } : undefined),
  pause: () => api('PUT', withDevice('/me/player/pause')),
  seek: ms => api('PUT', withDevice('/me/player/seek?position_ms=' + Math.round(ms))),
  volume: pct => api('PUT', withDevice('/me/player/volume?volume_percent=' + Math.round(pct))),
  repeatTrack: () => api('PUT', withDevice('/me/player/repeat?state=track')),
  transferTo: deviceId => api('PUT', '/me/player', { device_ids: [deviceId], play: false }),
  nowPlaying: () => api('GET', '/me/player/currently-playing'),
  search: q => api('GET', '/search?type=track&limit=10&q=' + encodeURIComponent(q)),  // Spotify's max is 10
  track: id => api('GET', '/tracks/' + id),
};

/** Pulls the fields we store from a Spotify track object. */
export function trackInfo(t) {
  const imgs = t.album?.images || [];
  return {
    uri: t.uri,
    trackName: t.name,
    artist: (t.artists || []).map(a => a.name).join(', '),
    trackDur: t.duration_ms,
    art: (imgs[imgs.length - 1] || imgs[0] || {}).url || '',  // smallest cover image
  };
}

/* ---------- error messages ---------- */

export function errorReason(res) {
  return res?.json?.error?.reason || res?.json?.error?.message || '';
}

export function notRegisteredMessage() {
  return usingDefaultApp()
    ? `Spotify does not allow this account in ${OWNER}'s app yet. ${OWNER} must add the email of this Spotify account under User Management. Then open ⚙︎, log out and log in again.`
    : 'Spotify does not allow this account in your app. In the Spotify dashboard, open your app → User Management and add this account\'s email. Then open ⚙︎, log out and log in again.';
}

export function explain(res) {
  const reason = errorReason(res);
  if (res.status === 0) return 'No connection to Spotify.';
  if (res.status === 404) return 'Spotify not responding. Make sure the app is open in the background and try to play a song on it.';
  if (res.status === 403 && /PREMIUM/i.test(reason)) return 'Spotify needs a Premium account for remote control.';
  if (res.status === 403 && /regist|dashboard/i.test(reason)) return notRegisteredMessage();
  if (res.status === 403) return 'Spotify refused this (' + reason + '). If the device is an iPhone, volume changes are not allowed.';
  if (res.status === 429) return 'Too many requests to Spotify. Wait a few seconds.';
  return 'Spotify error ' + res.status + (reason ? ': ' + reason : '');
}
