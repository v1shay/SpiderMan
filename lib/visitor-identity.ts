export const VISITOR_DEVICE_KEY = 'nyc-spider-device-v1';

type WritableStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type DeviceSignals = {
  userAgent: string;
  platform: string;
  languages: string;
  timezone: string;
  screen: string;
  pixelRatio: string;
  hardwareConcurrency: string;
  touchPoints: string;
};

export function getOrCreateDeviceId(
  storage: WritableStorage,
  createId = () => crypto.randomUUID(),
) {
  const existing = storage.getItem(VISITOR_DEVICE_KEY);
  if (existing) return existing;

  const created = createId();
  storage.setItem(VISITOR_DEVICE_KEY, created);
  return created;
}

export function readDeviceSignals(): DeviceSignals {
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    languages: navigator.languages.join(','),
    timezone: resolved.timeZone ?? '',
    screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
    pixelRatio: String(window.devicePixelRatio || 1),
    hardwareConcurrency: String(navigator.hardwareConcurrency || 0),
    touchPoints: String(navigator.maxTouchPoints || 0),
  };
}

export async function fingerprintDevice(signals: DeviceSignals) {
  const payload = Object.values(signals).join('\u001f');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
