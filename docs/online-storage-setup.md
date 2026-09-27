# Online storage (Cloudflare) — setup and upkeep

HEIA SOLA! keeps each person's buttons online with their Spotify account, using a free Cloudflare
Worker (a small program) and Cloudflare KV (storage). Free plan, no card, never pauses.

Worker address: **https://dark-butterfly-3c23.artiarbit.workers.dev** (Ørjan's Cloudflare account).

## One-time setup (done 27 Sep 2026)
1. Cloudflare account at dash.cloudflare.com (free).
2. Storage & Databases → **KV** → namespace `heiasola`.
3. Compute (Workers) → Workers & Pages → a Worker (this one is called `dark-butterfly-3c23`).
4. Worker → Settings → **Bindings** → KV namespace, variable name **`DB`** → namespace `heiasola`.

## Updating the Worker code
Needed only when `cloudflare/worker.js` changes (Claude will say so). Pushing to GitHub does **not**
update the Worker.
1. Open the Worker in the Cloudflare dashboard → **Edit code**.
2. Select all the code and delete it. Paste the whole of `cloudflare/worker.js` from the repository
   (github.com/artiarbit/heiasola → cloudflare → worker.js → the copy button).
3. Press **Deploy**.
4. Check: open the Worker's address in a browser. It should say
   `{"error":"Spotify did not recognise this login."}` — that means the code and storage are working.
   If it says "Storage not connected", step 4 of the setup (the `DB` binding) is missing.

## Upkeep
- **See what's stored:** Storage & Databases → KV → `heiasola`. Keys `list:<spotify id>` hold each
  person's buttons; `shared` holds songs shared with everyone.
- **Remove a shared song** so future users don't get it: edit the `shared` value and delete that
  song's entry. (People who already got it keep it until they delete the button.)
- **Free limits:** 100,000 requests and 1,000 saves per day — far more than a club needs.
- **Turn online storage off:** set `CLOUD_URL = ''` in `js/config.js` and push. Phones keep their buttons.
