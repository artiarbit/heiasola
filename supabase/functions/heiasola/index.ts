// HEIA SOLA! online storage API — a Supabase Edge Function named "heiasola".
//
// Who is calling is proven by their Spotify login: the app sends its Spotify access token in the
// "x-spotify-token" header, and this function asks Spotify who that is. So nobody can read or
// change another person's list, even if they know this address.
//
//   GET   → { user, list, shared }   this person's saved list (or null) + all shared songs
//   PUT   { clips, sharedSeen }      save this person's list
//   POST  { clip }                   share a song with everyone
//
// Deploy: Supabase dashboard → Edge Functions → create "heiasola", paste this file,
// and turn OFF "Verify JWT" (the app proves identity with Spotify instead).
//
// Written without TypeScript types so the test (tests/smoke.test.mjs) can run it in Node too.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-spotify-token',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
};
const MAX_CLIPS = 300;
const MAX_BYTES = 300000;
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

/**
 * db:         { getList(id), saveList(id, name, clips, sharedSeen), listShared(), addShared(clip, user) }
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
        const [list, shared] = await Promise.all([db.getList(user.id), db.listShared()]);
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
        await db.saveList(user.id, user.name, clips, seen);
        return json(200, { ok: true });
      }

      if (req.method === 'POST') {
        const body = await req.json();
        if (!isValidClip(body.clip)) return json(400, { error: 'That is not a valid song.' });
        const row = await db.addShared(shareable(body.clip), user);
        return json(200, { shared: row });
      }

      return json(405, { error: 'Not supported.' });
    } catch (e) {
      return json(500, { error: String(e?.message || e) });
    }
  };
}

/* ---------- running inside Supabase ---------- */
if (typeof Deno !== 'undefined') {
  const { createClient } = await import('jsr:@supabase/supabase-js@2');
  const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const check = ({ data, error }) => { if (error) throw error; return data; };

  const db = {
    getList: id => sb.from('lists').select('clips, shared_seen, updated_at').eq('spotify_id', id).maybeSingle().then(check),
    saveList: (id, name, clips, sharedSeen) => sb.from('lists')
      .upsert({ spotify_id: id, display_name: name, clips, shared_seen: sharedSeen, updated_at: new Date().toISOString() })
      .then(check),
    listShared: () => sb.from('shared_songs').select('id, clip, shared_by_name, created_at').order('id').limit(1000).then(check),
    addShared: (clip, user) => sb.from('shared_songs')
      .insert({ clip, shared_by_id: user.id, shared_by_name: user.name })
      .select('id, clip, shared_by_name, created_at').single().then(check),
  };

  const spotifyMe = async token => {
    const r = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: 'Bearer ' + token } });
    return r.ok ? r.json() : null;
  };

  Deno.serve(makeHandler({ db, spotifyMe }));
}
