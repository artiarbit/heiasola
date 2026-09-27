# HEIA SOLA! — notes for Claude

A phone web app for Ørjan's daughter's handball matches (Sola). Big buttons play a short clip of a
Spotify song when the team scores. It is a remote control: the page tells the Spotify app on a
device to play song X from position Y, then pauses it. No audio is played by the page itself.

Live at **https://artiarbit.github.io/heiasola/**. Hosted on GitHub Pages from `main` (root).
**Pushing to `main` deploys**; it is live 1–2 minutes later. Ørjan is not a developer: explain changes
in plain words, test before pushing, and push when he asks for a change.

## Files

| File | What it does |
|---|---|
| `index.html` | All markup: header, setup screen, button grid, now-playing bar, Settings sheet, Editor sheet. No inline JS/CSS. |
| `css/app.css` | All styles, grouped by screen. Yellow/black, dark only. Tokens at the top. |
| `js/config.js` | Fixed settings: owner name, default Spotify Client ID, silent track, colours, timings. |
| `js/defaults.js` | The club's default buttons (see "Updating the defaults"). |
| `js/store.js` | localStorage wrapper (`gmr-` prefix — keep it, phones already store data under it). |
| `js/state.js` | Shared `state` object + tiny event bus (`on`/`emit`), save helpers. Event list at the top. |
| `js/spotify.js` | Login (PKCE, no server), token refresh, `api()`, `spotify.*` endpoint helpers, error messages. |
| `js/devices.js` | Device polling, status light, choosing the device (phone first, never a speaker automatically). |
| `js/player.js` | Play/stop clips, fade, Random, keep-awake silent track, editor listening helpers. |
| `js/ui.js` | Main screen rendering: buttons, countdowns, status chip, toasts, keyboard. |
| `js/editor.js` | Edit/new button sheet. |
| `js/settings.js` | Settings sheet. |
| `js/setup.js` | First-time setup screen (join Ørjan's app group, or own Spotify app). |
| `js/main.js` | Entry point: wires everything up. |
| `js/dom.js` | `$`, `el`, time formatting, clipboard. |
| `js/cloud.js` | Online storage: sync each person's list with their Spotify account; "Share with everyone". |
| `cloudflare/worker.js` | The online storage API: a Cloudflare Worker + KV. Checks the caller with Spotify. |
| `docs/online-storage-setup.md` | Cloudflare setup, how Ørjan updates the Worker code, upkeep. |
| `tests/helpers.mjs` | Shared test setup: static server, fake Spotify, `check`/`finish`. |
| `tests/smoke.test.mjs` | End-to-end test with a fake Spotify, online storage off. |
| `tests/cloud.test.mjs` | Online storage test: real Worker code on a fake KV, two users, several phones, offline, KV delay. |

Plain ES modules, no build step, no framework, no dependencies at runtime. Keep it that way.
Logic modules change `state` and `emit(...)`; screen modules listen with `on(...)` and redraw.
Screen modules only touch the DOM inside `init*()` functions or handlers (avoids import-order problems).

## Button data

`state.clips` is an array of buttons, saved as JSON in `localStorage['gmr-clips']`:

```js
{ id, name, color,            // label and colour on the button
  uri, trackName, artist, art, trackDur,   // Spotify song (trackDur in ms, art = small cover URL)
  start,                      // clip start in ms
  dur,                        // clip length in SECONDS (end = start + dur*1000)
  fade,                       // fade-out seconds (only works on devices that allow volume control)
  special?: true,             // the two wide Heia Sola! buttons at the top (not numbered, not in Random)
  noRandom?: true,            // left out of the Random button
  pinned?: true,              // favourite: shown first with a pin instead of a number (personal, not shared)
  sharedBy?: 'Ørjan',         // came from someone's "Share with everyone" (id is then 'sh' + shared row id)
  sharedAt?: 1759000000000 }  // when this person last shared it
```

Other keys: `gmr-tok` (login), `gmr-clientId`, `gmr-device` (`chosen: true` if picked in Settings),
`gmr-ka` (keep-awake `{on, uri, name}`), `gmr-cloudSeen` (newest shared song merged), `gmr-cloudDirty`
(changes not uploaded yet), `gmr-cloudSavedAt` (time of last upload), `gmr-cloudUrl` (test-only
override of `CLOUD_URL`: another address or `'off'`; tests set `'off'` unless testing online storage). Old keys `gmr-seeded`, `gmr-specials`, `gmr-mig` may exist
on older phones and are ignored. Never rename keys or change field meanings without a migration.

## Updating the defaults

Ørjan sends a backup (⚙︎ → Backup → Copy). Replace the array in `js/defaults.js` with it, one button
per line. New phones get it on first login; existing phones only via ⚙︎ → Reset to Heia Sola! defaults.

## Online storage (Cloudflare Worker + KV)

`CLOUD_URL` in `js/config.js` points at Ørjan's Worker (https://dark-butterfly-3c23.artiarbit.workers.dev).
Set it to `''` to go back to phone-only. Details in the comment at the top of `js/cloud.js`:
- The app calls the Worker with the Spotify access token in `x-spotify-token`; the Worker asks Spotify
  `/me` who that is and only reads/writes that person's KV key (`list:<spotify id>`). KV binding: `DB`.
- KV can take up to ~60 s to show a write everywhere. The phone stores the time of its last upload
  (`cloudSavedAt`) and ignores an online copy older than that.
- Shared songs live in one KV key `shared`; the Worker marks each as `mine` for the caller (never
  sends others' Spotify ids). Your own shares are never merged back into your own list.
- On login and when the app returns to the screen: fetch the list. Online wins, unless the phone has
  un-uploaded changes (`cloudDirty`), then the phone wins. Songs shared since `shared_seen` are appended
  (skipping songs already on the list, matched by Spotify URI). Deleted shared songs don't come back.
- Every save is uploaded ~0.8 s later. Last writer wins between two phones.
- Sharing sends only the song and timing (`CLIP_FIELDS` in the function), not personal flags.
- To remove a shared song for future users: edit the `shared` KV value in the Cloudflare dashboard.

## Spotify facts that shape the design

- The owner's app is in **development mode**: max 5 added users + owner, each needs **Premium**.
  Users not added under User Management can log in but every API call returns **403**.
  Extended access requires a registered business with ~250k users — not an option.
  So new users either join Ørjan's app or create their own (setup screen option B).
- Since Feb 2026, dev-mode apps **cannot read a user's email**; search returns at most 10 results.
- **iPhones refuse remote volume changes**, so fades only work on computers/speakers.
- The iOS Spotify app falls asleep a few minutes after music stops and disappears from the device list.
  Hence **keep-awake**: the silent track "Silence 10 Minutes" plays on repeat between clips.
- Latency: a press is ~0.5–2 s (network). With keep-awake off, the last song is left paused at its
  start ("cue"), so pressing that button again is a faster plain resume.
- Storage is per browser: Safari and the home-screen icon on iPhone have separate storage.

## Conventions

- UI text: English, short, plain. Owner name comes from `OWNER` in config (also hardcoded in the setup
  markup in `index.html` — change both).
- Phone first (~375–400 px wide): the header must fit on one row; check with a screenshot.
- Keep functions small and named for what they do; comment the *why*, not the *what*.
- Don't reintroduce removed features (Warm-up button, song-search seeding, screen-on toggle).

## Testing and shipping

```sh
node tests/smoke.test.mjs      # needs Playwright (npm i -D playwright, or global); screenshots → tests/out/
node tests/cloud.test.mjs      # online storage against the real Worker code on a fake KV
python3 -m http.server 8000    # manual look: http://localhost:8000 (modules don't load from file://)
```

Add a check to the tests for any new behaviour. Changes to `cloudflare/worker.js` are not deployed by
pushing: Ørjan must paste it into the Worker again (steps in `docs/online-storage-setup.md`). Commit with a clear message and push to
`main`. GitHub Pages caches files for ~10 minutes, so a phone may need a reload after that.
