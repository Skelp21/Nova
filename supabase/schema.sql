-- Nota: one row per user with the synced library (playlists, likes, history).
-- Run once in Supabase → SQL Editor.
create table if not exists public.libraries (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.libraries enable row level security;

-- Each user can only see and change their own library.
drop policy if exists "own library" on public.libraries;
create policy "own library" on public.libraries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
