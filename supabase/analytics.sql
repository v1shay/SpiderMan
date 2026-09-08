-- Dedicated, append-only anonymous traffic counter for New York.
-- Uses explicit grants for Supabase projects where Data API exposure is opt-in.
create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  visited_at timestamptz not null default now(),
  session_id uuid not null,
  device_id uuid,
  device_fingerprint text check (
    device_fingerprint is null
    or device_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  page_host text check (
    page_host is null
    or char_length(page_host) between 1 and 253
  ),
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
  and (device_fingerprint is null or device_fingerprint ~ '^[0-9a-f]{64}$')
  and (page_host is null or char_length(page_host) between 1 and 253)
);

comment on table public.site_visits is 'Append-only page-view events. Stores random browser IDs and one-way device signatures; no IP address or raw fingerprint attributes are retained.';
