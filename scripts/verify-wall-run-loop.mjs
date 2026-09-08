// Run in the actual repository after installation (requires its installed Three).
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs/promises';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ContextualAnimationGraph } from '../lib/contextual-animation.ts';
import { nativeSegment } from '../lib/native-animation.ts';
import { closeWallRunLoop } from '../lib/looped-wall-run.ts';
const source = new THREE.AnimationClip('cropped-wall-run', 1, [
  new THREE.VectorKeyframeTrack(
    'hips.position',
    [0, 0.5, 1],
    [0, 0, 0, 1, 1, 0, 2, 0.2, 0],
  ),
  new THREE.QuaternionKeyframeTrack(
    'leg.quaternion',
    [0, 0.5, 1],
    [0, 0, 0, 1, 0, 0.70710678, 0, 0.70710678, 0, 1, 0, 0],
  ),
]);
const original = source.tracks.map((track) => Array.from(track.values));
const loop = closeWallRunLoop(source);
assert.notEqual(loop, source);
for (const [index, track] of loop.tracks.entries()) {
  const size = track.getValueSize();
  assert.deepEqual(
    Array.from(track.values.slice(-size)),
    Array.from(track.values.slice(0, size)),
  );
  assert.deepEqual(Array.from(source.tracks[index].values), original[index]);
  assert.ok(Array.from(track.values).every(Number.isFinite));
  if (track.ValueTypeName === 'quaternion')
    for (let i = 0; i < track.values.length; i += 4) {
      assert.ok(
        Math.abs(Math.hypot(...track.values.slice(i, i + 4)) - 1) < 1e-5,
      );
    }
}
console.log(
  'PASS run-loop endpoints match, source is unchanged, rotations remain normalized',
);

// Also check the exact imported 2099 clip and its runtime graph selection.
const bytes = await fs.readFile(
  new URL('../public/assets/animations/mixamo-2099.glb', import.meta.url),
);
const pack = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  '',
);
const authored = pack.animations.find(
  (clip) => clip.name === 'mixamo:Wall Run',
);
assert.ok(authored, 'The supplied pack must contain Wall Run');
const crop = nativeSegment(
  authored,
  authored.duration * 0.17,
  authored.duration * 0.5,
  'source-crop',
);
const graph = new ContextualAnimationGraph(pack.animations);
const selected = graph.select(1 / 60, {
  pose: 'run',
  mode: 'wallRun',
  grounded: false,
  speed: 30,
});
assert.equal(
  selected.loop,
  THREE.LoopRepeat,
  'Wall-run footwork must play forward across the seam',
);
assert.equal(selected.clip.name, 'context:wall-run');
assert.equal(selected.clip.duration, crop.duration);
assert.equal(selected.clip.tracks.length, crop.tracks.length);
for (const [index, track] of selected.clip.tracks.entries()) {
  const size = track.getValueSize();
  assert.deepEqual(
    Array.from(track.values.slice(-size)),
    Array.from(track.values.slice(0, size)),
  );
  assert.ok(Array.from(track.values).every(Number.isFinite));
  const originalTrack = crop.tracks[index].InterpolantFactoryMethodLinear();
  for (let i = 0; i < track.times.length; i++) {
    const sample = Array.from(track.values.slice(i * size, (i + 1) * size));
    assert.ok(Math.abs(Math.hypot(...sample) - 1) < 1e-5);
    if (track.times[i] < crop.duration - Math.min(0.12, crop.duration * 0.2)) {
      const expected = Array.from(originalTrack.evaluate(track.times[i]));
      assert.ok(
        sample.every((value, j) => Math.abs(value - expected[j]) < 1e-6),
        'Footwork before the seam blend must remain unchanged',
      );
    }
  }
}
const ledge = graph.select(1 / 60, {
  pose: 'run',
  mode: 'mantle',
  grounded: false,
  speed: 8,
});
assert.equal(ledge?.clip.name, 'context:wall-run-ledge');
assert.equal(ledge?.loop, THREE.LoopOnce);
assert.equal(
  ledge?.clip.duration,
  nativeSegment(
    authored,
    authored.duration * 0.5,
    authored.duration * 0.96,
    'ledge-crop',
  ).duration,
);
console.log(
  `PASS actual 2099 Wall Run: ${selected.clip.tracks.length} tracks, matching endpoints, normalized rotations, forward playback and unchanged footwork before the blend`,
);
console.log(
  'PASS ledge-climb frames are excluded from the loop and selected only for mantle',
);
console.log(
  'Animation-data verification; no claim of a visual browser playtest.',
);
