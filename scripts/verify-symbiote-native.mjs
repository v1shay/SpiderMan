import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SYMBIOTE_NATIVE_ROUTES, SymbioteAnimationGraph } from '../lib/symbiote-animation.ts';

const loader = () => {
  const instance = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  instance.register(parser => {
    parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
    return { name: 'CPUTextureStub' };
  });
  return instance;
};

async function readGlb(file) {
  const bytes = await fs.readFile(file);
  return loader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

const canonical = name => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const productionPath = new URL('../public/assets/suits/symbiote.glb', import.meta.url);
const production = await readGlb(productionPath);
const clips = production.animations;
const graph = new SymbioteAnimationGraph(clips);

const expectedInventory = new Map([
  ['Bully Walking', 1.433333],
  ['Crouched Walking', 1.066667],
  ['Flying Knee Punch Combo', 2.7],
  ['Grab and Slam', 4.3],
  ['Idle', 2],
  ['Low Crawl', 2.366667],
  ['Run', .566667],
  ['Swing to Land', 1.9],
]);
assert.equal(clips.length, expectedInventory.size, 'production Symbiote animation inventory changed');
for (const [name, duration] of expectedInventory) {
  const clip = clips.find(item => item.name === name);
  assert.ok(clip, `missing authored Symbiote clip: ${name}`);
  assert.ok(Math.abs(clip.duration - duration) < 1e-5, `${name} duration changed`);
  assert.equal(clip.tracks.length, 195, `${name} no longer targets the complete 65-bone rig`);
}

function fingerprint(clip) {
  const hash = crypto.createHash('sha256').update(clip.name).update(String(clip.duration));
  for (const track of clip.tracks) {
    hash.update(track.name);
    hash.update(Buffer.from(track.times.buffer, track.times.byteOffset, track.times.byteLength));
    hash.update(Buffer.from(track.values.buffer, track.values.byteOffset, track.values.byteLength));
  }
  return hash.digest('hex');
}

const routedSource = Object.fromEntries([...new Set(Object.values(SYMBIOTE_NATIVE_ROUTES))].map(name => {
  const clip = clips.find(item => canonical(item.name) === canonical(name));
  assert.ok(clip, `route points to a nonexistent clip: ${name}`);
  return [name, { clip, fingerprint: fingerprint(clip) }];
}));

const route = (pose, extra = {}) => graph.select(1 / 60, { pose, grounded: false, ...extra });
for (const [pose, name] of Object.entries(SYMBIOTE_NATIVE_ROUTES)) {
  const selection = route(pose, pose === 'swing' ? { tension: .5 } : {});
  assert.ok(selection, `${pose} did not select a native animation`);
  assert.strictEqual(selection.clip, routedSource[name].clip, `${pose} copied/retargeted ${name} instead of using its source identity`);
  assert.equal(selection.loop, pose === 'backflip' ? THREE.LoopOnce : THREE.LoopRepeat, `${pose} uses the wrong native playback mode`);
}
assert.equal(route('swing', { tension: 0 }).rate, .9);
assert.equal(route('swing', { tension: 1 }).rate, 1.1);
assert.strictEqual(route('swing').clip, route('zip').clip, 'swing-to-zip reset would lose the authored flip phase');
assert.strictEqual(route('zip').clip, route('fall').clip, 'zip-to-fall reset would lose the authored flip phase');

// New shared animation ownership: native traversal must never steal spawn,
// showroom, wall-crawl, wall-run, grounded locomotion, or rooftop poses.
for (const pose of ['crawl', 'wall', 'idle', 'perch', 'run']) assert.equal(route(pose), undefined, `${pose} was incorrectly claimed by Symbiote native routing`);
for (const pose of Object.keys(SYMBIOTE_NATIVE_ROUTES)) {
  assert.equal(graph.select(1 / 60, { pose, grounded: pose === 'jump', lobby: true }), undefined, `native ${pose} stole the shared spawn/showroom state`);
}
for (const { clip, fingerprint: before } of Object.values(routedSource)) {
  assert.equal(fingerprint(clip), before, `${clip.name} source keys were mutated by routing`);
}

// Confirm the complete clips contain the large acrobatic motion that was lost
// when Swing to Land became a frozen hang and Flying Knee stopped being routed.
function animatedRange(clip) {
  let widest = 0;
  for (const track of clip.tracks) {
    const size = track.getValueSize();
    for (let component = 0; component < size; component++) {
      let low = Infinity, high = -Infinity;
      for (let offset = component; offset < track.values.length; offset += size) {
        low = Math.min(low, track.values[offset]); high = Math.max(high, track.values[offset]);
      }
      widest = Math.max(widest, high - low);
    }
  }
  return widest;
}
assert.ok(animatedRange(routedSource['Swing to Land'].clip) > 1, 'native swing/flip curves became static');
assert.ok(animatedRange(routedSource['Flying Knee Punch Combo'].clip) > 1, 'native jump/knee curves became static');

// When the original high-resolution download is present, prove the optimized
// game asset evaluates to the same authored rotations/translations at every
// retained key. CI remains self-contained when Downloads is unavailable.
const downloadNames = [
  'spider-man_2_symbiote_suit_ps5.glb',
  'spider-man_2_symbiote_suit_ps5 (1).glb',
];
let auditedSources = 0;
for (const filename of downloadNames) {
  const file = path.join(os.homedir(), 'Downloads', filename);
  try { await fs.access(file); } catch { continue; }
  const original = await readGlb(file);
  assert.deepEqual(original.animations.map(clip => clip.name), clips.map(clip => clip.name), `${filename} is not the production Symbiote source library`);
  for (const productionClip of clips) {
    const originalClip = original.animations.find(clip => clip.name === productionClip.name);
    assert.ok(originalClip);
    assert.ok(Math.abs(originalClip.duration - productionClip.duration) < 1e-5);
    for (const track of productionClip.tracks) {
      const sourceTrack = originalClip.tracks.find(item => item.name === track.name);
      assert.ok(sourceTrack, `${filename} lacks ${productionClip.name}/${track.name}`);
      const interpolant = sourceTrack.InterpolantFactoryMethodLinear();
      const size = track.getValueSize();
      for (let key = 0; key < track.times.length; key++) {
        const expected = interpolant.evaluate(track.times[key]);
        if (size === 4 && track.name.endsWith('.quaternion')) {
          const actualQ = new THREE.Quaternion().fromArray(track.values, key * size).normalize();
          const expectedQ = new THREE.Quaternion().fromArray(expected).normalize();
          assert.ok(actualQ.angleTo(expectedQ) < .015, `optimized rotation drifted from ${filename}: ${productionClip.name}/${track.name}`);
        } else {
          for (let component = 0; component < size; component++) {
            assert.ok(Math.abs(track.values[key * size + component] - expected[component]) < .003, `optimized key drifted from ${filename}: ${productionClip.name}/${track.name}`);
          }
        }
      }
    }
  }
  auditedSources++;
}

console.log(`PASS: restored exact native Symbiote jump/dive and swing/zip/fall routes; shared spawn and crawl remain unclaimed; ${auditedSources} high-resolution source GLB(s) matched.`);
