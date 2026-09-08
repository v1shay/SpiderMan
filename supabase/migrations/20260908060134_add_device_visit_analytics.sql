alter table public.site_visits
  add column if not exists device_id uuid,
  add column if not exists device_fingerprint text,
  add column if not exists page_host text;

alter table public.site_visits
  drop constraint if exists site_visits_device_fingerprint_check,
  add constraint site_visits_device_fingerprint_check
    check (
      device_fingerprint is null
      or device_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  drop constraint if exists site_visits_page_host_check,
  add constraint site_visits_page_host_check
    check (
      page_host is null
      or char_length(page_host) between 1 and 253
    );

create index if not exists site_visits_device_id_idx
  on public.site_visits (device_id)
  where device_id is not null;

create index if not exists site_visits_device_fingerprint_idx
  on public.site_visits (device_fingerprint)
  where device_fingerprint is not null;

create index if not exists site_visits_page_host_visited_at_idx
  on public.site_visits (page_host, visited_at desc)
  where page_host is not null;

drop policy if exists "visitors can record a page visit" on public.site_visits;
drop policy if exists "anonymous traffic can append visits" on public.site_visits;

create policy "visitors can record a page visit"
on public.site_visits
for insert
to anon, authenticated
with check (
  session_id is not null
  and char_length(path) between 1 and 300
  and (referrer_host is null or char_length(referrer_host) <= 180)
  and (device_fingerprint is null or device_fingerprint ~ '^[0-9a-f]{64}$')
  and (page_host is null or char_length(page_host) between 1 and 253)
);

comment on table public.site_visits is
  'Append-only page-view events. Stores random browser IDs and one-way device signatures; no IP address or raw fingerprint attributes are retained.';

comment on column public.site_visits.device_id is
  'Random UUID persisted in localStorage for unique-browser counts on one origin.';

comment on column public.site_visits.device_fingerprint is
  'SHA-256 of browser/device signals for approximate cross-origin deduplication.';

comment on column public.site_visits.page_host is
  'Host that served the page, used to separate localhost development traffic from deployed traffic.';
