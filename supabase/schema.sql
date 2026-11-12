-- =====================================================================
-- Yiwu Supplier Manager — Supabase schema
-- Run once in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run (idempotent).
--
-- Design notes
--  * Primary keys are UUIDs generated on the phone, so offline retries are idempotent upserts.
--  * updated_at  = time of the user's edit on the device (used for last-write-wins conflicts)
--  * server_updated_at = set by the server on every write (used as the download cursor)
--  * deleted = soft delete, so deletions synchronise to other devices
--  * No foreign keys between tables on purpose: devices upload in batches and may be
--    interrupted; orphan rows are harmless and are linked again by later batches.
--  * Row Level Security: every row belongs to auth.uid(); nobody else can read or write it.
-- =====================================================================

create or replace function public.ysm_touch() returns trigger
language plpgsql as $$
begin
  new.server_updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;  -- ownership can never be changed
  end if;
  return new;
end $$;

-- ---------- suppliers ----------
create table if not exists public.suppliers (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text not null,
  company_name text not null default '',
  contact_person text not null default '',
  wechat_id text not null default '',
  phone text not null default '',
  email text not null default '',
  district text not null default '',
  floor text not null default '',
  street text not null default '',
  booth text not null default '',
  location_notes text not null default '',
  category text not null default '',
  supplier_type text not null default 'unknown',
  status text not null default 'new',
  rating smallint check (rating is null or rating between 1 and 5),
  follow_up_date date,
  follow_up_note text not null default '',
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

-- ---------- products ----------
create table if not exists public.products (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supplier_id uuid not null,
  name text not null default '',
  category text not null default '',
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

-- ---------- quotations ----------
create table if not exists public.quotations (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null,
  supplier_id uuid not null,
  price numeric(14,4) not null,
  currency text not null default 'CNY',
  unit text not null default 'piece',
  moq integer,
  tier_qty integer,
  quote_date date,
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

-- ---------- photos (metadata; image files live in Storage bucket "supplier-photos") ----------
create table if not exists public.photos (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supplier_id uuid not null,
  product_id uuid,
  kind text not null,
  caption text not null default '',
  width integer not null default 0,
  height integer not null default 0,
  bytes integer not null default 0,
  mime text not null default 'image/jpeg',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

-- ---------- triggers, indexes, RLS ----------
do $$
declare t text;
begin
  foreach t in array array['suppliers','products','quotations','photos'] loop
    execute format('drop trigger if exists ysm_touch on public.%I', t);
    execute format('create trigger ysm_touch before insert or update on public.%I for each row execute function public.ysm_touch()', t);
    execute format('create index if not exists %I on public.%I (user_id, server_updated_at)', t || '_cursor_idx', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists "owner select" on public.%I', t);
    execute format('drop policy if exists "owner insert" on public.%I', t);
    execute format('drop policy if exists "owner update" on public.%I', t);
    execute format('drop policy if exists "owner delete" on public.%I', t);
    execute format('create policy "owner select" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy "owner insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy "owner update" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "owner delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------- private storage bucket for photos ----------
-- Files are stored as <user_id>/<photo_id>.jpg and daily snapshots as <user_id>/backups/<time>.zip;
-- only the owner can access their folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('supplier-photos', 'supplier-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','application/zip','application/octet-stream'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ysm photos select" on storage.objects;
drop policy if exists "ysm photos insert" on storage.objects;
drop policy if exists "ysm photos update" on storage.objects;
drop policy if exists "ysm photos delete" on storage.objects;

create policy "ysm photos select" on storage.objects for select to authenticated
  using (bucket_id = 'supplier-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "ysm photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'supplier-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "ysm photos update" on storage.objects for update to authenticated
  using (bucket_id = 'supplier-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'supplier-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "ysm photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'supplier-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
