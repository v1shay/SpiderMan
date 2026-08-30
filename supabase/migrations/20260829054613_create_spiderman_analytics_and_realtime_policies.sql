create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  session_id uuid not null,
  path text not null check (char_length(path) between 1 and 300),
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 180),
  visited_at timestamptz not null default now()
);

alter table public.site_visits enable row level security;

revoke all on table public.site_visits from anon, authenticated;
grant insert on table public.site_visits to anon, authenticated;

create policy "visitors can record a page visit"
on public.site_visits
for insert
to anon, authenticated
with check (
  session_id is not null
  and char_length(path) between 1 and 300
  and (referrer_host is null or char_length(referrer_host) <= 180)
);

create index if not exists site_visits_visited_at_idx
on public.site_visits (visited_at desc);

create policy "authenticated players can receive SpiderMan realtime"
on realtime.messages
for select
to authenticated
using (
  (select realtime.topic()) like 'spiderman:%'
  and realtime.messages.extension in ('broadcast', 'presence')
);

create policy "authenticated players can send SpiderMan realtime"
on realtime.messages
for insert
to authenticated
with check (
  (select realtime.topic()) like 'spiderman:%'
  and realtime.messages.extension in ('broadcast', 'presence')
);
