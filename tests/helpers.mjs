// Shared test helpers: static server for the app, fake Spotify, and a simple check/report.
// Used by smoke.test.mjs and cloud.test.mjs.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });

/* ---------- tiny static server (ES modules don't load from file://) ---------- */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
export const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
export const BASE = `http://localhost:${server.address().port}/`;

/* ---------- fake Spotify ---------- */
export const PHONE = { id: 'phone1', name: 'Test iPhone', type: 'Smartphone', is_active: false, supports_volume: false, volume_percent: 100 };
export const SPEAKER = { id: 'spk1', name: 'Living room', type: 'Speaker', is_active: true, supports_volume: true, volume_percent: 60 };
export const SILENT = { uri: 'spotify:track:silent', name: 'Silence 10 Minutes', duration_ms: 600000, artists: [{ name: 'x' }], album: { images: [] } };
export const NEW_SONG = { uri: 'spotify:track:NewSong000000000000001', name: 'New Song', duration_ms: 200000, artists: [{ name: 'Band' }], album: { name: 'Album', images: [] } };

export function fakeSpotify(page, { devicesStatus = 200 } = {}) {
  const calls = [];
  page.route('https://api.spotify.com/**', route => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace('/v1', '');
    calls.push({ method: req.method(), path: p, query: Object.fromEntries(url.searchParams), body: req.postData() ? JSON.parse(req.postData()) : null });
    if (p === '/me/player/devices') {
      if (devicesStatus === 403) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { status: 403, message: 'Check settings on developer.spotify.com/dashboard, the user may not be registered.' } }) });
      return route.fulfill({ json: { devices: [SPEAKER, PHONE] } });
    }
    if (p === '/search') return route.fulfill({ json: { tracks: { items: /silence/i.test(url.searchParams.get('q')) ? [SILENT] : [NEW_SONG] } } });
    if (p === '/me/player/currently-playing') return route.fulfill({ json: { item: { uri: NEW_SONG.uri }, progress_ms: 30000, is_playing: false } });
    return route.fulfill({ status: 204 });
  });
  page.route('https://accounts.spotify.com/**', route => route.fulfill({ body: 'login page' }));
  page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '' }));
  page.route('https://i.scdn.co/**', route => route.fulfill({ status: 404 }));
  return calls;
}

/* ---------- checks ---------- */
let failures = 0, passes = 0;
/** Prints the totals, closes the server and exits (code 1 if anything failed). */
export function finish() {
  server.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}
export function check(name, ok, detail = '') {
  if (ok) { passes++; console.log('  ✓ ' + name); }
  else { failures++; console.log('  ✗ ' + name + (detail ? '  →  ' + detail : '')); }
}
export const loggedIn = (access = 'x') => ({ 'gmr-tok': JSON.stringify({ access, refresh: 'y', exp: Date.now() + 3e6 }) });
export const LOGGED_IN = loggedIn();

export async function openApp(browser, { storage = LOGGED_IN, devicesStatus, setup } = {}) {
  const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const calls = fakeSpotify(page, { devicesStatus });
  if (setup) await setup(page);
  await page.addInitScript(s => {
    if (sessionStorage.getItem('seeded')) return;  // only on first load, so reloads keep what the app saved
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, storage);
  await page.goto(BASE);
  await page.waitForTimeout(500);
  return { page, calls, errors };
}
export const lastPlay = calls => [...calls].reverse().find(c => c.path === '/me/player/play' && c.body?.uris);
export const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('gmr-clips')));

