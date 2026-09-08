import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SUITS } from '../lib/game-config.ts';
import { retargetMixamoClips, normalizeSuit } from '../lib/three-assets.ts';
const loader = new GLTFLoader();
loader.register((p) => {
  p.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'CPU' };
});
async function load(path) {
  const b = await fs.readFile('public' + path);
  return loader.parseAsync(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    '',
  );
}
const base = SUITS.find((s) => s.id === 'miguel'),
  source = await load(base.model),
  pack = await load(base.animationSource);
const key = (n) =>
  n
    .toLowerCase()
    .replace(/^(?:mixamorig|peter)/, '')
    .replace(/_\d+.*$/, '');
const bones = (root) => {
  const out = new Map();
  root.traverse((o) => {
    if (o.isBone) out.set(key(o.name), o);
  });
  return out;
};
const sb = bones(source.scene);
const segments = [
  ['leftarm', 'leftforearm'],
  ['leftforearm', 'lefthand'],
  ['rightarm', 'rightforearm'],
  ['rightforearm', 'righthand'],
  ['leftupleg', 'leftleg'],
  ['leftleg', 'leftfoot'],
  ['rightupleg', 'rightleg'],
  ['rightleg', 'rightfoot'],
];
const reports = [];
for (const suit of SUITS) {
  const model = await load(suit.model),
    library = await load(suit.animationSource),
    clips = retargetMixamoClips(library.animations, library.scene, model.scene);
  assert.equal(clips.length, 63, suit.id);
  assert.equal(
    clips.filter((c) => c.name === `lobby:dance:${suit.id}`).length,
    1,
    `${suit.id} unique dance`,
  );
  const sm = new THREE.AnimationMixer(source.scene),
    tm = new THREE.AnimationMixer(model.scene),
    tb = bones(model.scene);
  let worst = 1,
    maximumSpan = 0,
    samples = 0;
  const restHeight = new THREE.Box3()
    .setFromObject(model.scene, true)
    .getSize(new THREE.Vector3()).y;
  for (const clip of clips.filter((c) => c.name.startsWith('mixamo:'))) {
    const sourceClip = pack.animations.find((c) => c.name === clip.name);
    for (const [m, c] of [
      [sm, sourceClip],
      [tm, clip],
    ]) {
      const a = m.clipAction(c);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.play();
    }
    for (let f = 0; f <= 12; f++) {
      const t = (clip.duration * f) / 12;
      sm.setTime(t);
      tm.setTime(t);
      source.scene.updateMatrixWorld(true);
      model.scene.updateMatrixWorld(true);
      for (const [a, b] of segments) {
        assert.ok(tb.has(a) && tb.has(b), `${suit.id} ${a}`);
        const dir = (map) =>
          map
            .get(b)
            .getWorldPosition(new THREE.Vector3())
            .sub(map.get(a).getWorldPosition(new THREE.Vector3()))
            .normalize();
        worst = Math.min(worst, dir(sb).dot(dir(tb)));
      }
      const box = new THREE.Box3();
      model.scene.traverse((o) => {
        if (!o.isMesh) return;
        for (
          let i = 0;
          i < o.geometry.attributes.position.count;
          i += Math.max(
            1,
            Math.floor(o.geometry.attributes.position.count / 150),
          )
        ) {
          const p = o
            .getVertexPosition(i, new THREE.Vector3())
            .applyMatrix4(o.matrixWorld);
          assert.ok(p.toArray().every(Number.isFinite));
          box.expandByPoint(p);
        }
      });
      maximumSpan = Math.max(
        maximumSpan,
        box.getSize(new THREE.Vector3()).length() / restHeight,
      );
      samples++;
    }
    sm.stopAllAction();
    tm.stopAllAction();
  }
  const dance = clips.find((c) => c.name === `lobby:dance:${suit.id}`),
    danceAction = tm.clipAction(dance).reset().play();
  let danceSpan = 0;
  for (let f = 0; f <= 30; f++) {
    danceAction.time = (dance.duration * f) / 30;
    tm.update(0);
    model.scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    model.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (
        let i = 0;
        i < o.geometry.attributes.position.count;
        i += Math.max(1, Math.floor(o.geometry.attributes.position.count / 150))
      ) {
        const p = o
          .getVertexPosition(i, new THREE.Vector3())
          .applyMatrix4(o.matrixWorld);
        assert.ok(
          p.toArray().every(Number.isFinite),
          `${suit.id} dance finite skin`,
        );
        box.expandByPoint(p);
      }
    });
    danceSpan = Math.max(
      danceSpan,
      box.getSize(new THREE.Vector3()).length() / restHeight,
    );
  }
  danceAction.stop();
  const report = {
    id: suit.id,
    clips: clips.length,
    samples,
    worstLimbDirection: worst,
    maximumRelativeSkinSpan: maximumSpan,
    danceRelativeSkinSpan: danceSpan,
    passed: worst > 0.97 && maximumSpan < 3 && danceSpan < 3,
  };
  reports.push(report);
  console.log(report);
  normalizeSuit(model.scene, suit);
  assert.ok(model.scene.scale.toArray().every(Number.isFinite));
}
await fs.writeFile(
  'docs/verification/character-lineup.json',
  JSON.stringify(reports, null, 2) + '\n',
);
assert.ok(
  reports.every((r) => r.passed),
  'All selectable rigs must pass fidelity and skin bounds',
);
