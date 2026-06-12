create extension if not exists "pgcrypto";

drop table if exists public.settlement_members cascade;
drop function if exists public.can_access_settlement(uuid) cascade;
drop function if exists public.join_settlement(uuid) cascade;

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  title text not null default '새 정산',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.settlements enable row level security;
revoke all on public.settlements from public, anon, authenticated;

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

do $migration$
declare
  room record;
  candidate_key text;
  used_keys text[] := array[]::text[];
  characters constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
begin
  for room in
    select id, share_key
    from public.settlements
    order by created_at, id
  loop
    candidate_key := upper(
      substr(regexp_replace(coalesce(room.share_key, ''), '[^A-Za-z0-9]', '', 'g'), 1, 4)
    );

    if length(candidate_key) <> 4 or candidate_key = any(used_keys) then
      loop
        select string_agg(
          substr(characters, floor(random() * 36)::integer + 1, 1),
          ''
        )
        into candidate_key
        from generate_series(1, 4);

        exit when not (candidate_key = any(used_keys));
      end loop;
    end if;

    update public.settlements
    set share_key = candidate_key
    where id = room.id;

    used_keys := array_append(used_keys, candidate_key);
  end loop;
end;
$migration$;

alter table public.settlements alter column share_key set not null;

create unique index if not exists settlements_share_key_idx
on public.settlements (share_key);

drop trigger if exists settlements_set_updated_at on public.settlements;
drop function if exists public.make_share_key() cascade;
drop function if exists public.set_updated_at() cascade;
drop function if exists public.create_settlement(text, jsonb) cascade;
drop function if exists public.join_settlement(text) cascade;
drop function if exists public.get_settlement(uuid, text) cascade;
drop function if exists public.update_settlement(uuid, text, text, jsonb) cascade;
drop function if exists public.delete_settlement(uuid, uuid) cascade;

create or replace function public.make_share_key()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  candidate_key text;
begin
  loop
    select string_agg(
      substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', floor(random() * 36)::integer + 1, 1),
      ''
    )
    into candidate_key
    from generate_series(1, 4);

    exit when not exists (
      select 1
      from public.settlements
      where share_key = candidate_key
    );
  end loop;
  return candidate_key;
end;
$function$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

create trigger settlements_set_updated_at
before update on public.settlements
for each row execute function public.set_updated_at();

create or replace function public.create_settlement(
  settlement_title text,
  settlement_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  new_record public.settlements;
begin
  insert into public.settlements (title, data, share_key)
  values (
    coalesce(nullif(trim(settlement_title), ''), '새 정산'),
    settlement_data,
    public.make_share_key()
  )
  returning * into new_record;

  return jsonb_build_object(
    'id', new_record.id,
    'title', new_record.title,
    'data', new_record.data,
    'share_key', new_record.share_key,
    'owner_key', new_record.owner_key,
    'created_at', new_record.created_at,
    'updated_at', new_record.updated_at
  );
end;
$function$;

create or replace function public.join_settlement(participation_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  found_record public.settlements;
begin
  select *
  into found_record
  from public.settlements
  where share_key = upper(regexp_replace(participation_key, '[^A-Za-z0-9]', '', 'g'));

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', found_record.id,
    'title', found_record.title,
    'data', found_record.data,
    'share_key', found_record.share_key,
    'created_at', found_record.created_at,
    'updated_at', found_record.updated_at
  );
end;
$function$;

create or replace function public.get_settlement(
  target_id uuid,
  access_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  found_record public.settlements;
begin
  select *
  into found_record
  from public.settlements
  where id = target_id
    and (
      share_key = upper(regexp_replace(access_key, '[^A-Za-z0-9]', '', 'g'))
      or owner_key::text = access_key
    );

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', found_record.id,
    'title', found_record.title,
    'data', found_record.data,
    'share_key', found_record.share_key,
    'created_at', found_record.created_at,
    'updated_at', found_record.updated_at
  );
end;
$function$;

create or replace function public.update_settlement(
  target_id uuid,
  access_key text,
  settlement_title text,
  settlement_data jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.settlements
  set
    title = coalesce(nullif(trim(settlement_title), ''), '새 정산'),
    data = settlement_data
  where id = target_id
    and (
      share_key = upper(regexp_replace(access_key, '[^A-Za-z0-9]', '', 'g'))
      or owner_key::text = access_key
    );

  return found;
end;
$function$;

create or replace function public.delete_settlement(
  target_id uuid,
  deletion_key uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
begin
  delete from public.settlements
  where id = target_id
    and owner_key = deletion_key;

  return found;
end;
$function$;

revoke all on function public.make_share_key() from public, anon, authenticated;
revoke all on function public.create_settlement(text, jsonb) from public;
revoke all on function public.join_settlement(text) from public;
revoke all on function public.get_settlement(uuid, text) from public;
revoke all on function public.update_settlement(uuid, text, text, jsonb) from public;
revoke all on function public.delete_settlement(uuid, uuid) from public;

grant execute on function public.create_settlement(text, jsonb) to anon, authenticated;
grant execute on function public.join_settlement(text) to anon, authenticated;
grant execute on function public.get_settlement(uuid, text) to anon, authenticated;
grant execute on function public.update_settlement(uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.delete_settlement(uuid, uuid) to anon, authenticated;
