import assert from 'node:assert/strict';
import {
  fingerprintDevice,
  getOrCreateDeviceId,
  VISITOR_DEVICE_KEY,
} from '../lib/visitor-identity.ts';

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};

let creates = 0;
const createId = () => {
  creates += 1;
  return 'a8322f69-bf3c-4f86-8dab-a487438c4984';
};

const deviceId = getOrCreateDeviceId(storage, createId);
assert.equal(deviceId, 'a8322f69-bf3c-4f86-8dab-a487438c4984');
assert.equal(getOrCreateDeviceId(storage, createId), deviceId);
assert.equal(values.get(VISITOR_DEVICE_KEY), deviceId);
assert.equal(creates, 1);

const signals = {
  userAgent: 'verification-browser',
  platform: 'verification-platform',
  languages: 'en-US,en',
  timezone: 'America/Los_Angeles',
  screen: '1920x1080x24',
  pixelRatio: '2',
  hardwareConcurrency: '8',
  touchPoints: '0',
};
const first = await fingerprintDevice(signals);
const second = await fingerprintDevice({ ...signals });
const changed = await fingerprintDevice({ ...signals, screen: '1440x900x24' });

assert.match(first, /^[a-f0-9]{64}$/);
assert.equal(first, second);
assert.notEqual(first, changed);
assert.ok(!first.includes(signals.userAgent));

console.log('PASS: stable browser identity and one-way device signature.');
