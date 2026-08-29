import { createClient } from '@supabase/supabase-js';

let sent = false;

export async function trackVisit() {
  if (sent || typeof window === 'undefined') return;
  sent = true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return;

  try {
    const storageKey = 'nyc-spider-session';
    const existing = window.sessionStorage.getItem(storageKey);
    const sessionId = existing ?? crypto.randomUUID();
    if (!existing) window.sessionStorage.setItem(storageKey, sessionId);
    const supabase = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { error } = await supabase.from('site_visits').insert({
      session_id: sessionId,
      path: window.location.pathname,
      referrer_host: document.referrer ? new URL(document.referrer).host.slice(0, 180) : null,
    });
    if (error) console.info('Visit analytics unavailable:', error.message);
  } catch (error) {
    console.info('Visit analytics unavailable:', error instanceof Error ? error.message : error);
  }
}
