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

  console.log('Pinning');
  {
    await page.click('#editBtn');
    const third = page.locator('#grid .pad[data-id]').nth(2);
    const id = await third.getAttribute('data-id');
    await third.click();
    await page.check('#edPin');
    await page.click('#edSave');
    await page.click('#editBtn');
    const first = page.locator('#grid .pad[data-id]').first();
    check('pinned song moves to the top', (await first.getAttribute('data-id')) === id);
    check('it shows a pin instead of a number', await first.locator('.num.pin svg').count() === 1);
    check('numbering starts at 1 after the pinned songs', (await page.locator('#grid .pad[data-id]').nth(1).locator('.num').textContent()) === '1');
    await page.screenshot({ path: path.join(OUT, '2b-pinned.png') });
    await page.reload(); await page.waitForTimeout(500);
    check('pin is kept after reload', (await page.locator('#grid .pad[data-id]').first().getAttribute('data-id')) === id);
  }

  console.log('Pin toggle (Edit mode only)');
  {
    check('no pin toggles outside Edit mode', await page.locator('#grid .pintog').count() === 0);
    await page.click('#editBtn');
    const pads = page.locator('#grid .pad[data-id]');
    const target = pads.nth(3);  // a numbered song
    const id = await target.getAttribute('data-id');
    await target.locator('.pintog').click();
    await page.waitForTimeout(200);
    check('tapping the pin does not open the editor', !(await page.isVisible('#edScrim')));
    check('tapping the pin moves the song to the top', (await pads.first().getAttribute('data-id')) === id || (await pads.nth(1).getAttribute('data-id')) === id);
    await page.screenshot({ path: path.join(OUT, '2c-pin-toggle.png') });
    await page.locator(`#grid .pad[data-id="${id}"] .pintog`).click();
    await page.waitForTimeout(200);
    check('tapping the pin again unpins it', !(await stored(page)).find(c => c.id === id).pinned);
    await page.click('#editBtn');
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

  console.log('Dropped connections and login renewal');
  {
    // 1. The first try gets no answer (like an iPhone's dropped idle connection); the second works.
    const { page, calls, errors } = await openApp(browser);
    let dropped = 0;
    await page.route('https://api.spotify.com/v1/me/player/play**', route => (dropped++ === 0 ? route.abort('connectionreset') : route.fallback()));
    await page.click('#grid .pad[data-id]:first-child');
    await page.waitForTimeout(800);
    check('a dropped connection is retried and the song plays', !!lastPlay(calls) && await page.locator('#grid .pad.playing').count() === 1);
    check('no error message after a successful retry', !(await page.isVisible('#toast')) || (await page.textContent('#toast')).length === 0 || !/answer|connection/i.test(await page.textContent('#toast')));

    // 2. Spotify doesn't answer at all: clear message, and the light is re-checked straight away.
    await page.click('#stopBtn'); await page.waitForTimeout(300);
    await page.unroute('https://api.spotify.com/v1/me/player/play**');
    await page.route('https://api.spotify.com/v1/me/player/play**', route => route.abort('internetdisconnected'));
    const checksBefore = calls.filter(c => c.path === '/me/player/devices').length;
    await page.click('#grid .pad[data-id]:first-child');
    await page.waitForTimeout(1500);
    check('no answer at all gives a clear message', /did not answer/.test(await page.textContent('#toast')));
    check('the light is re-checked after a failed press', calls.filter(c => c.path === '/me/player/devices').length > checksBefore);
    check('no JS errors', !errors.length, errors.join(' | '));
    await page.close();
  }
  {
    // Spotify answers 502 (couldn't reach the phone's Spotify app in time): retried, then a clear message.
    const { page, calls, errors } = await openApp(browser);
    let n = 0;
    await page.route('https://api.spotify.com/v1/me/player/play**', route => (n++ === 0
      ? route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":{"status":502,"message":"Bad gateway."}}' })
      : route.fallback()));
    await page.click('#grid .pad[data-id]:first-child');
    await page.waitForTimeout(1500);
    check('a single 502 from Spotify is retried and the song plays', await page.locator('#grid .pad.playing').count() === 1);
    await page.click('#stopBtn'); await page.waitForTimeout(300);
    await page.unroute('https://api.spotify.com/v1/me/player/play**');
    await page.route('https://api.spotify.com/v1/me/player/play**', route => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":{"status":502,"message":"Bad gateway."}}' }));
    await page.click('#grid .pad[data-id]:first-child');
    await page.waitForTimeout(2000);
    const msg = await page.textContent('#toast');
    check('repeated 502 gives the "make sure the app is open" message, not "Bad gateway"', /Make sure the app is open/.test(msg) && !/502|gateway/i.test(msg), msg);
    check('no JS errors', !errors.length, errors.join(' | '));
    await page.close();
  }
  {
    // 3. Login renewal can't reach Spotify: stay logged in.
    const expired = { 'gmr-tok': JSON.stringify({ access: 'old', refresh: 'r1', exp: Date.now() - 1000 }) };
    const { page } = await openApp(browser, { storage: expired, setup: p => p.route('https://accounts.spotify.com/api/token', r => r.abort('internetdisconnected')) });
    check('a network blip during login renewal does not log out', await page.isVisible('#main') && !(await page.isVisible('#setup')));
    await page.close();
  }
  {
    // 4. Spotify refuses the renewal (login revoked): log out with a clear message.
    const expired = { 'gmr-tok': JSON.stringify({ access: 'old', refresh: 'r1', exp: Date.now() - 1000 }) };
    const { page } = await openApp(browser, { storage: expired, setup: p => p.route('https://accounts.spotify.com/api/token', r => r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_grant","error_description":"Refresh token revoked"}' })) });
    check('a refused renewal shows the login screen', await page.isVisible('#setup'));
    check('and says the login expired', /login has expired/.test(await page.textContent('#toast')));
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
