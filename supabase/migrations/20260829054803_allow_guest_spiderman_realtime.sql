drop policy if exists "authenticated players can receive SpiderMan realtime" on realtime.messages;
drop policy if exists "authenticated players can send SpiderMan realtime" on realtime.messages;

create policy "guests can receive SpiderMan realtime"
on realtime.messages
for select
to anon, authenticated
using (
  (select realtime.topic()) like 'spiderman:%'
  and realtime.messages.extension in ('broadcast', 'presence')
);

create policy "guests can send SpiderMan realtime"
on realtime.messages
for insert
to anon, authenticated
with check (
  (select realtime.topic()) like 'spiderman:%'
  and realtime.messages.extension in ('broadcast', 'presence')
);
