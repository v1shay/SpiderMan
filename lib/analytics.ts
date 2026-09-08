import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import {
  fingerprintDevice,
  getOrCreateDeviceId,
  readDeviceSignals,
} from '@/lib/visitor-identity';

let sent = false;

export async function trackVisit() {
  if (sent || typeof window === 'undefined') return;
  sent = true;
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;

  try {
    const sessionStorageKey = 'nyc-spider-session';
    const existing = window.sessionStorage.getItem(sessionStorageKey);
    const sessionId = existing ?? crypto.randomUUID();
    if (!existing) window.sessionStorage.setItem(sessionStorageKey, sessionId);
    const deviceId = getOrCreateDeviceId(window.localStorage);
    const deviceFingerprint = await fingerprintDevice(readDeviceSignals());
    let referrerHost: string | null = null;
    if (document.referrer) {
      try {
        referrerHost = new URL(document.referrer).host.slice(0, 180);
      } catch {
        referrerHost = null;
      }
    }
    const { error } = await supabase.from('site_visits').insert({
      session_id: sessionId,
      device_id: deviceId,
      device_fingerprint: deviceFingerprint,
      page_host: window.location.host.slice(0, 253),
      path: window.location.pathname,
      referrer_host: referrerHost,
    });
    if (error) console.info('Visit analytics unavailable:', error.message);
  } catch (error) {
    console.info('Visit analytics unavailable:', error instanceof Error ? error.message : error);
  }
}
