# Setting up online storage (Supabase) — about 15 minutes

Do this on a computer; it's much easier than on a phone.

## 1. Create a free Supabase project
1. Go to **https://supabase.com** → **Start your project** → sign in (GitHub login is easiest).
2. **New project**. Name: `heiasola`. Set a database password (save it somewhere; you won't need it
   day to day). Region: **Europe (Stockholm or Frankfurt)**. Plan: **Free**. Press **Create new project**
   and wait a minute until it's ready.

## 2. Create the tables
1. Left menu → **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` in the GitHub repository (github.com/artiarbit/heiasola), copy all of it,
   paste it into the editor, and press **Run**. It should say "Success. No rows returned".

## 3. Create the function
1. Left menu → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name it exactly `heiasola`.
3. Delete the example code. Copy all of `supabase/functions/heiasola/index.ts` from the repository and paste it in.
4. Press **Deploy function**.
5. Open the function's **Details** (or Settings) and turn **OFF** "Verify JWT" / "Enforce JWT verification".
   Save. (The app proves who you are with your Spotify login instead.)
6. Copy the function's URL. It looks like `https://abcdefghijklmnop.supabase.co/functions/v1/heiasola`.

## 4. Send the URL to Claude
Claude puts it in `js/config.js` (`CLOUD_URL`) and pushes. After that:
- Open the app on your phone first. Your current buttons are uploaded as your online list.
- Others' buttons are uploaded the first time they open the app.
- ⚙︎ Settings shows **Online storage: Saved online** and which Spotify account you're logged in as.

## Later
- **See what's stored:** Table Editor → `lists` (one row per person) and `shared_songs`.
- **Remove a shared song** so future users don't get it: delete its row in `shared_songs`.
  (People who already got it keep it until they delete the button.)
- **Free plan pause:** Supabase pauses free projects after a week with no use. The app then shows
  "Online storage error" and keeps working with the buttons on the phone. Press **Restore** in the
  Supabase dashboard to wake it. Opening the app regularly (e.g. weekly matches) keeps it awake.
