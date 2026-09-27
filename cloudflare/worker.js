// HEIA SOLA! online storage — a Cloudflare Worker with a KV namespace bound as "DB".
//
// Who is calling is proven by their Spotify login: the app sends its Spotify access token in the
// "x-spotify-token" header, and this Worker asks Spotify who that is. So nobody can read or change
// another person's list, even if they know this address.
//
//   GET   → { user, list, shared }          this person's saved list (or null) + all shared songs
//                                            (each marked `mine` if this person shared it)
//   PUT   { clips, sharedSeen } → { ok, updatedAt }   save this person's list
//   POST  { clip } → { shared }             share a song with everyone
//
// Storage (KV):  "list:<spotify id>" → { clips, shared_seen, display_name, updated_at }
//                "shared"            → [ { id, clip, shared_by_id, shared_by_name, created_at }, … ]
// KV can take up to a minute to show a change everywhere; the app guards against reading an
// older copy of its own list (see js/cloud.js).
//
// Deploy: Cloudflare dashboard → Workers & Pages → the Worker → Edit code → paste this file → Deploy.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-spotify-token',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const MAX_CLIPS = 300;
const MAX_BYTES = 300000;
const MAX_SHARED = 500;
const CLIP_FIELDS = ['name', 'color', 'uri', 'trackName', 'artist', 'art', 'trackDur', 'start', 'dur', 'fade'];

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function isValidClip(c) {
  return !!c && typeof c === 'object'
    && /^spotify:track:[A-Za-z0-9]{22}$/.test(c.uri)
    && typeof c.name === 'string' && c.name.length <= 80
    && Number.isFinite(c.start) && c.start >= 0
    && Number.isFinite(c.dur) && c.dur > 0 && c.dur <= 3600;
}

/** Only the song and its timing are shared, not personal flags like "special" or "not in Random". */
function shareable(c) {
  const out = {};
  for (const k of CLIP_FIELDS) if (c[k] !== undefined) out[k] = c[k];
  return out;
}

/** KV-backed storage. `kv` needs get(key, { type: 'json' }) and put(key, string). */
export function kvDb(kv) {
  const listShared = async () => (await kv.get('shared', { type: 'json' })) || [];
  return {
    getList: id => kv.get('list:' + id, { type: 'json' }),
    async saveList(id, name, clips, sharedSeen) {
      const row = { clips, shared_seen: sharedSeen, display_name: name, updated_at: Date.now() };
      await kv.put('list:' + id, JSON.stringify(row));
      return row.updated_at;
    },
    listShared,
    async addShared(clip, user) {
      const list = await listShared();
      // Time-based ids: always increasing, and two shares can't get the same number.
      const id = Math.max(Date.now(), (list.at(-1)?.id || 0) + 1);
      const row = { id, clip, shared_by_id: user.id, shared_by_name: user.name, created_at: new Date().toISOString() };
      list.push(row);
      await kv.put('shared', JSON.stringify(list.slice(-MAX_SHARED)));
      return row;
    },
  };
}

/**
 * db:         { getList(id), saveList(id, name, clips, sharedSeen) → updatedAt, listShared(), addShared(clip, user) }
 * spotifyMe:  token → Spotify profile ({ id, display_name }) or null
 */
export function makeHandler({ db, spotifyMe }) {
  const who = new Map();  // token → { id, name, until }; saves asking Spotify on every call

  async function caller(req) {
    const token = req.headers.get('x-spotify-token');
    if (!token) return null;
    const hit = who.get(token);
    if (hit && hit.until > Date.now()) return hit;
    const me = await spotifyMe(token);
    if (!me?.id) return null;
    const user = { id: me.id, name: me.display_name || me.id, until: Date.now() + 10 * 60 * 1000 };
    if (who.size > 1000) who.clear();
    who.set(token, user);
    return user;
  }

  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      const user = await caller(req);
      if (!user) return json(401, { error: 'Spotify did not recognise this login.' });

      if (req.method === 'GET') {
        const [list, rows] = await Promise.all([db.getList(user.id), db.listShared()]);
        // Don't hand out other people's Spotify ids; just say which shares are the caller's own.
        const shared = rows.map(({ shared_by_id, ...row }) => ({ ...row, mine: shared_by_id === user.id }));
        return json(200, { user: { id: user.id, name: user.name }, list, shared });
      }

      if (req.method === 'PUT') {
        const text = await req.text();
        if (text.length > MAX_BYTES) return json(413, { error: 'Too much data.' });
        const body = JSON.parse(text);
        const clips = body.clips;
        if (!Array.isArray(clips) || clips.length > MAX_CLIPS || !clips.every(c => c && typeof c === 'object' && typeof c.id === 'string')) {
          return json(400, { error: 'That is not a valid button list.' });
        }
        const seen = Number.isFinite(body.sharedSeen) ? body.sharedSeen : 0;
        const updatedAt = await db.saveList(user.id, user.name, clips, seen);
        return json(200, { ok: true, updatedAt });
      }

      if (req.method === 'POST') {
        const body = await req.json();
        if (!isValidClip(body.clip)) return json(400, { error: 'That is not a valid song.' });
        const { shared_by_id, ...row } = await db.addShared(shareable(body.clip), user);
        return json(200, { shared: { ...row, mine: true } });
      }

      return json(405, { error: 'Not supported.' });
    } catch (e) {
      return json(500, { error: String(e?.message || e) });
    }
  };
}

async function spotifyMe(token) {
  const r = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: 'Bearer ' + token } });
  return r.ok ? r.json() : null;
}

let handler = null;  // one per Worker instance, so the Spotify lookups are cached between requests

export default {
  async fetch(request, env) {
    if (!env.DB) return json(500, { error: 'Storage not connected: add a KV binding named DB to this Worker.' });
    handler ||= makeHandler({ db: kvDb(env.DB), spotifyMe });
    return handler(request);
  },
};
