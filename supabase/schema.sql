-- HEIA SOLA! online storage. Paste into Supabase → SQL Editor → Run.
-- Safe to run more than once.

-- Each person's buttons, keyed by their Spotify account id.
create table if not exists public.lists (
  spotify_id    text primary key,
  display_name  text,
  clips         jsonb not null default '[]'::jsonb,
  shared_seen   bigint not null default 0,          -- newest shared song already merged into this list
  updated_at    timestamptz not null default now()
);

-- Songs someone pressed "Share with everyone" on.
create table if not exists public.shared_songs (
  id              bigint generated always as identity primary key,
  clip            jsonb not null,
  shared_by_id    text not null,
  shared_by_name  text,
  created_at      timestamptz not null default now()
);

-- Lock both tables. There are deliberately no policies: the browser can't touch them directly.
-- Only the "heiasola" Edge Function can, after checking with Spotify who is logged in.
alter table public.lists enable row level security;
alter table public.shared_songs enable row level security;
