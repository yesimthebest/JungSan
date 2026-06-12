create function public.make_share_key()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  candidate_key text;
begin
  loop
    candidate_key :=
      substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', floor(random() * 36)::integer + 1, 1) ||
      substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', floor(random() * 36)::integer + 1, 1) ||
      substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', floor(random() * 36)::integer + 1, 1) ||
      substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', floor(random() * 36)::integer + 1, 1);
    exit when not exists (
      select 1 from public.settlements where share_key = candidate_key
    );
  end loop;
  return candidate_key;
end;
$$;

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger settlements_set_updated_at
before update on public.settlements
for each row execute function public.set_updated_at();

create function public.create_settlement(
  settlement_title text,
  settlement_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  return to_jsonb(new_record);
end;
$$;

create function public.join_settlement(participation_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(s) - 'owner_key'
  from public.settlements s
  where s.share_key = upper(
    regexp_replace(participation_key, '[^A-Za-z0-9]', '', 'g')
  );
$$;

create function public.get_settlement(target_id uuid, access_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(s) - 'owner_key'
  from public.settlements s
  where s.id = target_id
    and (
      s.share_key = upper(regexp_replace(access_key, '[^A-Za-z0-9]', '', 'g'))
      or s.owner_key::text = access_key
    );
$$;

create function public.update_settlement(
  target_id uuid,
  access_key text,
  settlement_title text,
  settlement_data jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
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
$$;

create function public.delete_settlement(target_id uuid, deletion_key uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.settlements
  where id = target_id and owner_key = deletion_key;
  return found;
end;
$$;

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
