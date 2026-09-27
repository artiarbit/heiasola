// Online storage test: the real app talks to the real backend code (supabase/functions/heiasola)
// running in this test with an in-memory database. Two Spotify users, several "phones".
// Run:  node tests/cloud.test.mjs

import { makeHandler } from '../supabase/functions/heiasola/index.ts';
import path from 'node:path';
import { playwright, OUT, loggedIn, check, finish, openApp, stored } from './helpers.mjs';

const CLOUD = 'https://cloud.test/functions/v1/heiasola';
const USERS = { tokA: { id: 'orjan', display_name: 'Ørjan' }, tokB: { id: 'kari', display_name: 'Kari' } };

/* ---------- in-memory database behind the real handler ---------- */
const lists = new Map();
const shared = [];
const db = {
  getList: async id => lists.get(id) || null,
  saveList: async (id, name, clips, sharedSeen) => { lists.set(id, { clips: JSON.parse(JSON.stringify(clips)), shared_seen: sharedSeen }); },
  listShared: async () => shared,
  addShared: async (clip, user) => { const row = { id: shared.length + 1, clip, shared_by_name: user.name }; shared.push(row); return row; },
};
const handler = makeHandler({ db, spotifyMe: async token => USERS[token] || null });
let cloudDown = false;

async function routeCloud(page) {
  await page.route(CLOUD + '**', async route => {
    if (cloudDown) return route.abort('internetdisconnected');
    const r = route.request();
    const res = await handler(new Request(r.url(), { method: r.method(), headers: r.headers(), body: r.postData() || undefined }));
    route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
  });
}

const phone = (browser, token, extra = {}) =>
  openApp(browser, { storage: { ...loggedIn(token), 'gmr-cloudUrl': JSON.stringify(CLOUD), ...extra }, setup: routeCloud });
const settle = page => page.waitForTimeout(1500);  // sync + the short upload delay
const MY_OWN = { id: 'x1', name: 'My Song', color: '#FFD400', uri: 'spotify:track:MySong0000000000000001', trackName: 'Mine', artist: 'Me', art: '', trackDur: 100000, start: 5000, dur: 8, fade: 2 };

const browser = await playwright.chromium.launch();
try {
  console.log('First phone with online storage');
  const a1 = await phone(browser, 'tokA', { 'gmr-clips': JSON.stringify([MY_OWN]) });
  await settle(a1.page);
  check('phone\'s existing buttons are uploaded', lists.get('orjan')?.clips.length === 1 && lists.get('orjan').clips[0].id === 'x1');
  await a1.page.click('#setBtn');
  check('Settings shows the Spotify name', (await a1.page.textContent('#cloudUser')).includes('Ørjan'));
  check('Settings shows saved online', (await a1.page.textContent('#cloudTxt')).startsWith('Saved online'));
  await a1.page.locator('#cloudField').screenshot({ path: path.join(OUT, '4-online-storage.png') });
  await a1.page.click('#setClose');

  console.log('Same person, second phone');
  const a2 = await phone(browser, 'tokA');
  await settle(a2.page);
  check('second phone gets the online list, not the defaults', (await stored(a2.page)).length === 1 && (await a2.page.textContent('#grid .pad .name')) === 'My Song');
  await a2.page.click('#grid .pad.add');
  await a2.page.fill('#edSearch', 'new song');
  await a2.page.waitForSelector('#edResults .res');
  await a2.page.click('#edResults .res');
  await a2.page.click('#edSave');
  await settle(a2.page);
  check('a new song is uploaded', lists.get('orjan').clips.length === 2);

  console.log('Back on the first phone');
  await a1.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await settle(a1.page);
  check('first phone picks up the new song when reopened', (await stored(a1.page)).length === 2);

  console.log('Share with everyone');
  await a1.page.click('#editBtn');
  await a1.page.click('#grid .pad[data-id="x1"]');
  check('Share button shown for a saved song', await a1.page.isVisible('#edShare'));
  await a1.page.locator('#edShareField').screenshot({ path: path.join(OUT, '5-share.png') });
  await a1.page.click('#edShare');
  await settle(a1.page);
  check('song is shared, without personal settings', shared.length === 1 && shared[0].clip.uri === MY_OWN.uri && !('id' in shared[0].clip) && shared[0].shared_by_name === 'Ørjan');
  check('editor closes after sharing', !(await a1.page.isVisible('#edScrim')));

  console.log('Another person');
  const b1 = await phone(browser, 'tokB');
  await settle(b1.page);
  const bClips = await stored(b1.page);
  check('new person gets the defaults plus the shared song', bClips.length > 10 && bClips.at(-1).uri === MY_OWN.uri && bClips.at(-1).sharedBy === 'Ørjan');
  check('they are told about it', (await b1.page.textContent('#toast')).includes('New song from Ørjan'));
  check('their list is saved online separately', lists.get('kari')?.clips.length === bClips.length && lists.get('orjan').clips.length === 2);
  await b1.page.reload(); await settle(b1.page);
  check('the shared song is not added twice', (await stored(b1.page)).filter(c => c.uri === MY_OWN.uri).length === 1);

  console.log('Deleting a shared song sticks');
  await b1.page.click('#editBtn');
  await b1.page.click(`#grid .pad[data-id="${bClips.at(-1).id}"]`);
  await b1.page.click('#delWrap .btn');
  await b1.page.click('text=Yes, delete');
  await settle(b1.page);
  await b1.page.reload(); await settle(b1.page);
  check('a deleted shared song does not come back', !(await stored(b1.page)).some(c => c.uri === MY_OWN.uri));

  console.log('No connection');
  cloudDown = true;
  const before = lists.get('kari').clips.length;
  await b1.page.click('#editBtn');
  await b1.page.click('#grid .pad[data-id]:first-child');
  await b1.page.click('#delWrap .btn');
  await b1.page.click('text=Yes, delete');
  await settle(b1.page);
  check('change is kept on the phone while offline', (await stored(b1.page)).length === before - 1 && lists.get('kari').clips.length === before);
  check('phone remembers it has unsaved changes', await b1.page.evaluate(() => localStorage.getItem('gmr-cloudDirty')) === 'true');
  cloudDown = false;
  await b1.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await settle(b1.page);
  check('when back online, the phone\'s changes win and are uploaded', lists.get('kari').clips.length === before - 1);

  for (const { page, errors } of [a1, a2, b1]) {
    check('no JS errors', !errors.length, errors.join(' | '));
    await page.close();
  }
} finally {
  await browser.close();
}
finish();
