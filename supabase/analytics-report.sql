-- Approximate people by a one-way device signature. Any signature observed on
-- localhost is treated as the owner's browser for later production visits.
with owner_signatures as (
  select distinct device_fingerprint
  from public.site_visits
  where device_fingerprint is not null
    and (
      page_host like 'localhost:%'
      or page_host like '127.0.0.1:%'
      or page_host = 'localhost'
      or page_host = '127.0.0.1'
    )
), attributed as (
  select
    site_visits.*,
    case
      when page_host is null then 'legacy-unknown'
      when page_host like 'localhost:%'
        or page_host like '127.0.0.1:%'
        or page_host in ('localhost', '127.0.0.1') then 'owner-local'
      when device_fingerprint in (select device_fingerprint from owner_signatures)
        then 'owner-matched'
      else 'other-device'
    end as visitor_kind
  from public.site_visits
)
select
  visitor_kind,
  page_host,
  count(*)::int as views,
  count(distinct session_id)::int as sessions,
  count(distinct device_id)::int as browser_installations,
  count(distinct device_fingerprint)::int as approximate_devices,
  min(visited_at) as first_visit,
  max(visited_at) as last_visit
from attributed
group by visitor_kind, page_host
order by visitor_kind, views desc;
