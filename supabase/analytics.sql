-- Dedicated, append-only anonymous traffic counter for New York.
-- Uses explicit grants for Supabase projects where Data API exposure is opt-in.
create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  visited_at timestamptz not null default now(),
  session_id uuid not null,
  path text not null check (char_length(path) between 1 and 500),
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 180)
);

alter table public.site_visits enable row level security;

revoke all on table public.site_visits from anon, authenticated;
grant insert on table public.site_visits to anon, authenticated;

drop policy if exists "anonymous traffic can append visits" on public.site_visits;
create policy "anonymous traffic can append visits"
on public.site_visits
for insert
to anon, authenticated
with check (
  char_length(path) between 1 and 500
  and (referrer_host is null or char_length(referrer_host) <= 180)
);

comment on table public.site_visits is 'Append-only page-view events for the New York browser game. No IP address or user agent is stored.';
