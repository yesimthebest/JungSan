create extension if not exists "pgcrypto";

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  title text not null default '새 정산',
  data jsonb not null default '{}'::jsonb,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  share_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settlement_members (
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (settlement_id, user_id)
);

create or replace function public.can_access_settlement(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.settlements s
    where s.id = target_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1 from public.settlement_members m
          where m.settlement_id = s.id and m.user_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.join_settlement(invitation_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select id into target_id
  from public.settlements
  where share_token = invitation_token;

  if target_id is null then
    raise exception 'Invalid invitation';
  end if;

  insert into public.settlement_members (settlement_id, user_id)
  values (target_id, auth.uid())
  on conflict do nothing;

  return target_id;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists settlements_set_updated_at on public.settlements;
create trigger settlements_set_updated_at
before update on public.settlements
for each row execute function public.set_updated_at();

alter table public.settlements enable row level security;
alter table public.settlement_members enable row level security;

drop policy if exists "Members can read accessible settlements" on public.settlements;
create policy "Members can read accessible settlements"
on public.settlements for select to authenticated
using (public.can_access_settlement(id));

drop policy if exists "Users can create owned settlements" on public.settlements;
create policy "Users can create owned settlements"
on public.settlements for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists "Members can update accessible settlements" on public.settlements;
create policy "Members can update accessible settlements"
on public.settlements for update to authenticated
using (public.can_access_settlement(id))
with check (public.can_access_settlement(id));

drop policy if exists "Owners can delete settlements" on public.settlements;
create policy "Owners can delete settlements"
on public.settlements for delete to authenticated
using (owner_id = auth.uid());

drop policy if exists "Members can see their own memberships" on public.settlement_members;
create policy "Members can see their own memberships"
on public.settlement_members for select to authenticated
using (user_id = auth.uid());

revoke all on public.settlements from anon, authenticated;
grant select on public.settlements to authenticated;
grant insert (title, data) on public.settlements to authenticated;
grant update (title, data) on public.settlements to authenticated;
grant delete on public.settlements to authenticated;

revoke all on public.settlement_members from anon, authenticated;
grant select on public.settlement_members to authenticated;

revoke all on function public.join_settlement(uuid) from public, anon;
revoke all on function public.can_access_settlement(uuid) from public, anon;
grant execute on function public.join_settlement(uuid) to authenticated;
grant execute on function public.can_access_settlement(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.settlements;
exception
  when duplicate_object then null;
end;
$$;
