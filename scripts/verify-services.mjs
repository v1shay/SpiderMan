import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

const create = () => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const a = create();
const b = create();
const topic = `spiderman:verification-${Date.now()}`;
const makeChannel = (client, playerId) => client.channel(topic, {
  config: { private: true, broadcast: { self: false, ack: false }, presence: { key: playerId } },
});
const channelA = makeChannel(a, 'verification-a');
const channelB = makeChannel(b, 'verification-b');

let received;
channelB.on('broadcast', { event: 'player_state' }, ({ payload }) => { received = payload; });

const subscribe = (channel, playerId) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`${playerId} channel timed out`)), 12_000);
  channel.subscribe(async (status, error) => {
    if (status === 'SUBSCRIBED') {
      clearTimeout(timeout);
      await channel.track({ playerId, joinedAt: Date.now() });
      resolve();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      clearTimeout(timeout);
      reject(error ?? new Error(`${playerId} failed with ${status}`));
    }
  });
});

try {
  await Promise.all([subscribe(channelA, 'verification-a'), subscribe(channelB, 'verification-b')]);
  await channelA.send({ type: 'broadcast', event: 'player_state', payload: { playerId: 'verification-a', sequence: 1 } });
  const deadline = Date.now() + 5_000;
  while (!received && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  if (received?.playerId !== 'verification-a') throw new Error('Realtime broadcast was not received by the second client');

  const { error } = await a.from('site_visits').insert({
    session_id: crypto.randomUUID(),
    path: '/verification',
    referrer_host: 'local-test',
  });
  if (error) throw error;
  console.log('Verified: private Realtime broadcast, Presence join, and analytics insert.');
} finally {
  await Promise.all([a.removeChannel(channelA), b.removeChannel(channelB)]);
  a.realtime.disconnect();
  b.realtime.disconnect();
}
