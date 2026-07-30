-- Gemini clone — chats, messages, and private media storage.
-- Run this in the Supabase SQL editor (or `supabase db push`).
--
-- Every row is owned by a user and readable only by that user, enforced by RLS.
-- The server never uses a service_role key, so these policies are the only
-- thing standing between users' chats — they are not optional.

create extension if not exists "pgcrypto";

/* ------------------------------------------------------------------ tables */

create table if not exists public.chats (
  id           uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null default 'New chat',
  title_locked boolean not null default false,
  model        text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists chats_user_updated_idx
  on public.chats (user_id, updated_at desc);

create table if not exists public.messages (
  id          uuid primary key,
  chat_id     uuid not null references public.chats (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  seq         integer not null,
  role        text not null check (role in ('user', 'model')),
  text        text not null default '',
  thought     text not null default '',
  -- Raw Gemini parts, including thoughtSignature, replayed on the next turn.
  parts       jsonb not null default '[]'::jsonb,
  -- Attachments and images hold storage paths, never base64 payloads.
  attachments jsonb not null default '[]'::jsonb,
  images      jsonb not null default '[]'::jsonb,
  sources     jsonb not null default '[]'::jsonb,
  usage       jsonb,
  error       text,
  created_at  timestamptz not null default now(),
  unique (chat_id, seq)
);

create index if not exists messages_chat_seq_idx on public.messages (chat_id, seq);

/* --------------------------------------------------------------------- RLS */

alter table public.chats    enable row level security;
alter table public.messages enable row level security;

drop policy if exists "chats are private" on public.chats;
create policy "chats are private" on public.chats
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "messages are private" on public.messages;
create policy "messages are private" on public.messages
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

/* ---------------------------------------------------------------- triggers */

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists chats_touch on public.chats;
create trigger chats_touch before update on public.chats
  for each row execute function public.touch_updated_at();

-- Sidebar ordering follows the newest message, so writing a message bumps
-- its parent chat.
create or replace function public.touch_chat()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.chats
     set updated_at = now()
   where id = coalesce(new.chat_id, old.chat_id);
  return coalesce(new, old);
end $$;

drop trigger if exists messages_touch_chat on public.messages;
create trigger messages_touch_chat
  after insert or update or delete on public.messages
  for each row execute function public.touch_chat();

/* ------------------------------------------------------------------ storage */

-- Attachments and generated images live here, keyed by <user_id>/<chat_id>/...
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', false)
on conflict (id) do nothing;

drop policy if exists "own media read"   on storage.objects;
drop policy if exists "own media write"  on storage.objects;
drop policy if exists "own media delete" on storage.objects;

create policy "own media read" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own media write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own media delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-media' and (storage.foldername(name))[1] = auth.uid()::text);
