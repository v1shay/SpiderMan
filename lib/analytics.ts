import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

let sent = false;

export async function trackVisit() {
  if (sent || typeof window === 'undefined') return;
  sent = true;
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;

  try {
    const storageKey = 'nyc-spider-session';
    const existing = window.sessionStorage.getItem(storageKey);
    const sessionId = existing ?? crypto.randomUUID();
    if (!existing) window.sessionStorage.setItem(storageKey, sessionId);
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
