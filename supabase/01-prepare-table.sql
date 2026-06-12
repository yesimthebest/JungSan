create extension if not exists "pgcrypto";

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  title text not null default '새 정산',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.settlements enable row level security;
revoke all on public.settlements from public, anon, authenticated;

drop table if exists public.settlement_members cascade;
drop policy if exists "Members can read accessible settlements" on public.settlements;
drop policy if exists "Users can create owned settlements" on public.settlements;
drop policy if exists "Members can update accessible settlements" on public.settlements;
drop policy if exists "Owners can delete settlements" on public.settlements;

alter table public.settlements add column if not exists share_key text;
alter table public.settlements add column if not exists owner_key uuid default gen_random_uuid();

update public.settlements
set owner_key = gen_random_uuid()
where owner_key is null;

alter table public.settlements alter column owner_key set not null;
alter table public.settlements alter column owner_key set default gen_random_uuid();
alter table public.settlements drop column if exists owner_id cascade;
alter table public.settlements drop column if exists share_token cascade;

drop index if exists public.settlements_share_key_idx;

do $$
declare
  room record;
  candidate_key text;
  used_keys text[] := array[]::text[];
begin
  for room in
    select id, share_key from public.settlements order by created_at, id
  loop
    candidate_key := upper(substr(
      regexp_replace(coalesce(room.share_key, ''), '[^A-Za-z0-9]', '', 'g'),
      1,
      4
    ));

    while length(candidate_key) <> 4 or candidate_key = any(used_keys) loop
      candidate_key :=
        substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', floor(random() * 36)::integer + 1, 1) ||
        substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', floor(random() * 36)::integer + 1, 1) ||
        substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', floor(random() * 36)::integer + 1, 1) ||
        substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', floor(random() * 36)::integer + 1, 1);
    end loop;

    update public.settlements
    set share_key = candidate_key
    where id = room.id;

    used_keys := array_append(used_keys, candidate_key);
  end loop;
end;
$$;

alter table public.settlements alter column share_key set not null;

create unique index if not exists settlements_share_key_idx
on public.settlements (share_key);

drop trigger if exists settlements_set_updated_at on public.settlements;
drop function if exists public.can_access_settlement(uuid) cascade;
drop function if exists public.make_share_key() cascade;
drop function if exists public.set_updated_at() cascade;
drop function if exists public.create_settlement(text, jsonb) cascade;
drop function if exists public.join_settlement(uuid) cascade;
drop function if exists public.join_settlement(text) cascade;
drop function if exists public.get_settlement(uuid, text) cascade;
drop function if exists public.update_settlement(uuid, text, text, jsonb) cascade;
drop function if exists public.delete_settlement(uuid, uuid) cascade;
