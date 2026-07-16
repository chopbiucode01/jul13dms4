create table if not exists public.private_matches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  host_id uuid not null references auth.users(id) on delete cascade,
  guest_id uuid references auth.users(id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'finished', 'abandoned')),
  state jsonb not null,
  last_event jsonb not null default '{}'::jsonb,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours')
);

create index if not exists private_matches_code_idx on public.private_matches (code);
create index if not exists private_matches_expiry_idx on public.private_matches (expires_at);

alter table public.private_matches enable row level security;

drop policy if exists "participants can view private matches" on public.private_matches;
create policy "participants can view private matches"
on public.private_matches
for select
to authenticated
using ((select auth.uid()) = host_id or (select auth.uid()) = guest_id);

revoke all on public.private_matches from anon;
revoke insert, update, delete on public.private_matches from authenticated;
grant select on public.private_matches to authenticated;
grant all on public.private_matches to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'private_matches'
  ) then
    alter publication supabase_realtime add table public.private_matches;
  end if;
end $$;
