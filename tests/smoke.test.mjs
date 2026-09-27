// Smoke test: runs the real app in headless Chromium with a fake Spotify (online storage off).
// Run:  node tests/smoke.test.mjs      (needs Playwright: `npm i -D playwright` or a global install)
// Exit code 0 = all passed. Screenshots of each step land in tests/out/.

import path from 'node:path';
import { playwright, OUT, SILENT, NEW_SONG, LOGGED_IN, check, finish, openApp, lastPlay, stored } from './helpers.mjs';

const browser = await playwright.chromium.launch();
try {
  console.log('Setup screen');
  {
    const { page, errors } = await openApp(browser, { storage: {} });
    check('setup screen shows when logged out', await page.isVisible('#setup'));
    check('main screen hidden when logged out', !(await page.isVisible('#main')));
    await page.screenshot({ path: path.join(OUT, '1-setup.png') });
    const [req] = await Promise.all([page.waitForRequest(/accounts\.spotify\.com\/authorize/), page.click('#loginDefault')]);
    check('"Log in with Spotify" uses the default app', new URL(req.url()).searchParams.get('client_id') === 'd313ba4d10e0403fa567b4c59110550e');
    check('no JS errors', !errors.length, errors.join(' | '));
    await page.close();
  }

  console.log('First login');
  const { page, calls, errors } = await openApp(browser);
  {
    const clips = await stored(page);
    check('defaults loaded (2 specials + numbered)', clips.filter(c => c.special).length === 2 && clips.length > 10, clips.length + ' buttons');
    check('specials shown', await page.locator('#specials .pad').count() === 2);
    check('numbered buttons + Add tile shown', await page.locator('#grid .pad[data-id]').count() === clips.length - 2 && await page.isVisible('#grid .pad.add'));
    check('status chip says connected', (await page.textContent('#spotTxt')) === 'Spotify connected');
    check('phone chosen over active speaker', (await page.textContent('#nowLbl')) === 'Plays on Test iPhone');
    await page.screenshot({ path: path.join(OUT, '2-main.png') });
  }

  console.log('Playing');
  {
    const first = (await stored(page)).find(c => !c.special);
    await page.click('#grid .pad[data-id]:first-child');
    await page.waitForTimeout(300);
    const p = lastPlay(calls);
    check('button plays its song at its start', p?.body.uris[0] === first.uri && p.body.position_ms === Math.round(first.start), JSON.stringify(p?.body));
    check('command goes to the chosen device', p?.query.device_id === 'phone1');
    check('button marked playing', await page.locator('#grid .pad.playing').count() === 1);
    check('now-playing bar shows the name', (await page.textContent('#nowT')) === first.name);
    await page.click('#stopBtn');
    await page.waitForTimeout(300);
    check('STOP switches to the silent track (keep-awake)', lastPlay(calls)?.body.uris[0] === SILENT.uri);
    check('silent track set to repeat', calls.some(c => c.path === '/me/player/repeat'));
    check('nothing marked playing after STOP', await page.locator('.pad.playing').count() === 0);
  }

  console.log('Random');
  {
    const clips = await stored(page);
    const keep = clips.find(c => !c.special);
    await page.evaluate(k => {
      const list = JSON.parse(localStorage.getItem('gmr-clips'));
      list.forEach(c => { if (!c.special && c.id !== k) c.noRandom = true; });
      localStorage.setItem('gmr-clips', JSON.stringify(list));
    }, keep.id);
    await page.reload(); await page.waitForTimeout(500);
    const uris = new Set();
    for (let i = 0; i < 3; i++) { await page.click('#rndBtn'); await page.waitForTimeout(250); uris.add(lastPlay(calls)?.body.uris[0]); }
    check('Random only picks songs included in Random', uris.size === 1 && uris.has(keep.uri), [...uris].join(','));
    check('Random button counts down', /^\d+s$/.test(await page.textContent('#rndLbl')));
    await page.click('#stopBtn'); await page.waitForTimeout(300);
    check('Random button back to "Random" after STOP', (await page.textContent('#rndLbl')) === 'Random');
  }

  console.log('Editor');
  {
    const before = (await stored(page)).length;
    await page.click('#grid .pad.add');
    await page.fill('#edSearch', 'new song');
    await page.waitForSelector('#edResults .res');
    await page.click('#edResults .res');
    await page.mouse.click(200, 5);  // tap outside the sheet: must not close it
    check('tapping outside does not close the editor', await page.isVisible('#edScrim'));
    await page.click('[data-n="1"]');
    await page.click('[data-e="0.05"]');
    check('start moves by 1 s', (await page.textContent('#edStart')) === '0:01.00');
    check('end stays put when start moves, then moves by 0.05 s', (await page.textContent('#edEnd')) === '0:06.05');
    await page.click('#edSave');
    const clips = await stored(page);
    const added = clips.find(c => c.uri === NEW_SONG.uri);
    check('new song saved', clips.length === before + 1 && added?.start === 1000 && added?.dur === 5.05, JSON.stringify(added));
    await page.reload(); await page.waitForTimeout(500);
    check('new song still there after reload', await page.locator('#grid .pad[data-id]').count() === before - 1);
  }

  console.log('Settings');
  {
    await page.click('#setBtn');
    check('settings open', await page.isVisible('#setScrim'));
    check('keep-awake shows the silent track', (await page.textContent('#kaTrack')).includes('Silence 10 Minutes'));
    await page.screenshot({ path: path.join(OUT, '3-settings.png') });
    await page.click('#resetWrap .btn');
    await page.click('text=Yes, reset');
    const clips = await stored(page);
    check('reset restores defaults (new song gone)', !clips.some(c => c.uri === NEW_SONG.uri));
    await page.click('#setClose');
  }
  check('no JS errors during the session', !errors.length, errors.join(' | '));
  await page.close();

  console.log('Existing phone (saved by an older version)');
  {
    const own = [{ id: 'x1', name: 'My Song', color: '#FFD400', uri: 'spotify:track:mine', trackName: 'Mine', artist: 'Me', art: '', trackDur: 100000, start: 5000, dur: 8, fade: 2 }];
    const { page, errors } = await openApp(browser, { storage: { ...LOGGED_IN, 'gmr-clips': JSON.stringify(own), 'gmr-seeded': 'true', 'gmr-specials': 'true', 'gmr-mig': '1' } });
    check('keeps its own buttons (no defaults forced)', await page.locator('#grid .pad[data-id]').count() === 1 && (await page.textContent('#grid .pad .name')) === 'My Song');
    check('no JS errors', !errors.length, errors.join(' | '));
    await page.close();
  }

  console.log('Account not added to the app (403)');
  {
    const { page, errors } = await openApp(browser, { devicesStatus: 403 });
    check('chip says not connected', (await page.textContent('#spotTxt')) === 'Spotify not connected');
    check('message tells them to get added', /User Management/.test(await page.textContent('#toast')));
    check('no JS errors', !errors.length, errors.join(' | '));
    await page.close();
  }
} finally {
  await browser.close();
}
finish();
