import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DISTRICTS } from '../lib/game-config.ts';
import { WorldMeshQuery, capsuleSupportHeight } from '../lib/mesh-world.ts';
import { RepeatingMeshWorld } from '../lib/repeating-mesh-world.ts';
import { createSwingAssistanceState, stepSwingAssistance } from '../lib/swing-assistance.ts';
import { createTraversalState, stepTraversalInPlace, setTraversalKinematics, refreshTraversalContext } from '../lib/traversal-physics.ts';
import { calculateWallSkim } from '../lib/wall-skim.ts';
import { resolveSwingGroundContact } from '../lib/swing-ground-contact.ts';

// Geometry/physics integration, not texture or browser FPS verification. This
// intentionally mirrors SpiderGame's force -> swept mesh -> support -> rope
// validation order, including the real elevated anchor fan and holding W/reel.
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(parser => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'integrated_swing_skip_images', loadTexture: () => Promise.resolve(new THREE.Texture()) };
});
const wanted = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['new-york-city', 'street-city']);
const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1.3, 0);
const round = value => +value.toFixed(3);
const coordinates = point => [point.x, point.y, point.z].map(round);
let failures = 0;

function anchorsAt(world, point, forward) {
  const chest = new THREE.Vector3().copy(point).add(up);
  const heading = Math.atan2(-forward.x, -forward.z), candidates = [];
  for (const elevation of [.52, .87, 1.13]) for (const side of [-.9, -.45, 0, .45, .9]) {
    const yaw = heading + side;
    const direction = new THREE.Vector3(-Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), -Math.cos(yaw) * Math.cos(elevation));
    const hit = world.raycast(chest, direction, 145);
    if (!hit || hit.distance < 3 || hit.distance > 150) continue;
    const toward = hit.point.clone().sub(chest);
    if (world.raycast(chest, toward.clone().normalize(), toward.length() - .08)) continue;
    candidates.push({ id: `mesh:${hit.triangleIndex}:${hit.point.x.toFixed(1)}:${hit.point.z.toFixed(1)}`,
      point: hit.point, normal: hit.normal, kind: hit.normal.y > .65 ? 'roof' : 'facade', lineOfSight: true, weight: 1 + elevation * .12 });
  }
  return candidates;
}

function streetRoutes(world) {
  const routes = [];
  for (const spacing of [8, 20, 40]) {
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
      const hit = world.raycast({ x: x * spacing, y: 5, z: z * spacing }, down, 8, .85);
      if (!hit || hit.point.y > 1.5) continue;
      const point = hit.point.clone(); point.y = capsuleSupportHeight(hit);
      if (!world.isCapsuleClear(point)) continue;
      for (let direction = 0; direction < 8; direction++) {
        const angle = direction * Math.PI / 4;
        const forward = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
        const obstacle = world.raycast(point.clone().add(up), forward, 45);
        const clearance = obstacle?.distance ?? 45;
        if (clearance < 8) continue;
        const anchors = anchorsAt(world, point, forward);
        if (anchors.length) routes.push({ point, forward, anchors: anchors.length, score: clearance + anchors.length });
      }
    }
    if (routes.length > 12) break;
  }
  routes.sort((a, b) => b.score - a.score);
  const first = routes[0];
  assert.ok(first, 'Map must contain a capsule-clear street with a visible elevated triangle anchor.');
  const second = routes.find(route => route.forward.dot(first.forward) < .4 && route.point.distanceTo(first.point) > 3) ?? routes[1] ?? first;
  return [first, second, { ...first, point: first.point.clone().add(new THREE.Vector3(world.width * 7, 0, -world.depth * 5)) }];
}

function simulate(world, route, name) {
  const frameCount = name === 'central-street' ? 960 : 360;
  const state = createTraversalState(route.point), assistance = createSwingAssistanceState();
  state.grounded = true;
  const forward = route.forward, aim = forward.clone().add(new THREE.Vector3(0, .18, 0)).normalize();
  const times = [], events = {}, detaches = {}, sampleFailures = [], detachSamples = [];
  let airFrames = 0, swingFrames = 0, contacts = 0, wallFrames = 0, stalled = 0, penetrationFrames = 0;
  let groundSkims = 0, wallSkims = 0, wallSkimCooldown = 0;
  let distance = 0, maxHeight = state.position.y, maxSpeed = 0, assistanceFrames = 0, probes = 0;
  let anchorCount = 0, searches = 0, attachedAt = null, longestAttachment = 0, immediateDetaches = 0;
  let cachedAnchors = [], nextSearch = 0;
  const start = coordinates(state.position);
  for (let frame = 0; frame < frameCount; frame++) {
    const tickStart = performance.now(), dt = 1 / 60;
    const held = frameCount > 360 ? frame % 201 < 180 : frame >= 8 && frame < 168 || frame >= 206 && frame < 320;
    const input = { move: forward, cameraForward: forward, aimDirection: aim,
      jumpPressed: frame === 0 || frame === 198, jumpHeld: held,
      swingHeld: held, swingPressed: held, swingReleased: frameCount > 360 ? frame % 201 === 180 : frame === 168 || frame === 320,
      diveHeld: false, reel: held ? -1 : 0 };
    let candidates = [];
    if (!state.swing && !state.zip && held) {
      if (frame >= nextSearch) {
        const speed = Math.hypot(state.velocity.x, state.velocity.z);
        const heading = speed > 8 ? new THREE.Vector3(state.velocity.x, 0, state.velocity.z).normalize() : forward;
        cachedAnchors = anchorsAt(world, state.position, heading); nextSearch = frame + 5;
        searches++; anchorCount += cachedAnchors.length;
      }
      candidates = cachedAnchors;
    }
    const assisted = stepSwingAssistance(assistance, { position: state.position, velocity: state.velocity, dt,
      swinging: Boolean(state.swing && held), diving: false, desiredDirection: forward },
    (origin, direction, maximum) => world.raycast(origin, direction, maximum));
    Object.assign(state.velocity, assisted.velocity);
    probes += assisted.probeCount; assistanceFrames += +assisted.active;
    const before = new THREE.Vector3().copy(state.position), wasGrounded = state.grounded;
    const result = stepTraversalInPlace(state, input, {
      groundY: -10000, colliders: [], anchorColliders: [], wallContact: null,
      sampleGround: (point, rise, drop) => world.supportAt(point, rise, drop ?? .1)?.point.y ?? null,
      isCapsuleClear: (point, radius, height) => world.isCapsuleClear(point, radius, height, false),
      anchorCandidates: candidates, zipTargets: candidates,
    }, dt, { zipAcceleration: 126, zipDamping: 3.6, zipMaximumSpeed: 66 });
    for (const event of result.events) {
      events[event.type] = (events[event.type] ?? 0) + 1;
      if (event.type === 'web-attached') attachedAt = frame;
      if (event.type === 'web-released' && attachedAt !== null) {
        longestAttachment = Math.max(longestAttachment, frame - attachedAt); attachedAt = null;
      }
    }
    const attemptedVelocity = new THREE.Vector3().copy(state.velocity);
    const hit = world.sweepCapsule(before, state.position, state.velocity);
    const preFinalSnapPosition = hit.position.clone();
    const blocked = Boolean(hit.wallNormal) || hit.blocked && !hit.grounded;
    const support = hit.velocity.y <= .1 ? world.supportAt(hit.position, .015, .51) : null;
    const supportY = support ? capsuleSupportHeight(support) : null;
    state.grounded = supportY !== null && Math.abs(hit.position.y - supportY) < .045;
    if (state.grounded) {
      const exactSupport = hit.position.clone(); exactSupport.y = supportY;
      if (world.isCapsuleClear(exactSupport, .46, 2.05, false)) hit.position.y = supportY;
      else hit.position.y = Math.max(hit.position.y, supportY);
      hit.velocity.y = Math.max(0, hit.velocity.y); state.airSeconds = 0;
    }
    if (!wasGrounded && state.grounded) state.landingSeconds = .16;
    setTraversalKinematics(state, hit.position, hit.velocity);
    state.wall = null; state.wallCrawlActive = false;
    wallSkimCooldown = Math.max(0, wallSkimCooldown - dt);
    if (hit.wallNormal && state.swing && held && wallSkimCooldown <= 0) {
      const skim = calculateWallSkim(attemptedVelocity, hit.wallNormal, forward);
      if (skim.eligible) {
        const positiveOffset = hit.position.clone().addScaledVector(hit.wallNormal, .045);
        const negativeOffset = hit.position.clone().addScaledVector(hit.wallNormal, -.045);
        if (world.isCapsuleClear(positiveOffset, .46, 2.05, false)) hit.position.copy(positiveOffset);
        else if (world.isCapsuleClear(negativeOffset, .46, 2.05, false)) hit.position.copy(negativeOffset);
        hit.velocity.set(skim.velocity.x, skim.velocity.y, skim.velocity.z);
        state.swing = null; state.swingRetryAfter = state.elapsed + .18;
        state.grounded = false; state.landingSeconds = 0; wallSkimCooldown = .52; wallSkims++;
        setTraversalKinematics(state, hit.position, hit.velocity);
      }
    }
    if (state.swing) {
      const anchor = new THREE.Vector3().copy(state.swing.anchor);
      const chest = hit.position.clone().add(up), line = anchor.clone().sub(chest);
      const obstruction = world.raycast(chest, line.clone().normalize(), Math.max(0, line.length() - .1));
      const excess = hit.position.distanceTo(anchor) - state.swing.ropeLength;
      const groundContact = resolveSwingGroundContact({
        attemptedVelocity,
        sweptVelocity: hit.velocity,
        grounded: state.grounded,
        swingHeld: held,
        obstructed: Boolean(obstruction),
        hitWall: Boolean(hit.wallNormal),
        anchorHeight: anchor.y - hit.position.y,
        elevatedLaunch: hit.position.y > 18,
        tension: state.swing.tension,
        attachedSeconds: state.swing.attachedSeconds,
      });
      const groundSkim = groundContact.active;
      if (groundSkim) {
        hit.velocity.set(groundContact.velocity.x, groundContact.velocity.y, groundContact.velocity.z);
        state.grounded = !groundContact.liftOff;
        if (groundContact.liftOff) { hit.position.y += .012; state.landingSeconds = 0; }
        groundSkims++;
        setTraversalKinematics(state, hit.position, hit.velocity);
      }
      const conflict = blocked && !groundSkim && excess > Math.max(.25, state.swing.ropeLength * .01);
      const reason = obstruction ? 'blocked-web' : state.grounded && !groundSkim ? 'landed' : conflict ? 'solid-rope-conflict' : null;
      if (reason) {
        detaches[reason] = (detaches[reason] ?? 0) + 1;
        if (attachedAt !== null) {
          longestAttachment = Math.max(longestAttachment, frame - attachedAt);
          if (frame - attachedAt < 12) immediateDetaches++;
        }
        if (detachSamples.length < 8) detachSamples.push({ frame, reason, age: attachedAt === null ? null : frame - attachedAt,
          position: coordinates(hit.position), velocity: coordinates(hit.velocity), rope: round(state.swing.ropeLength), excess: round(excess),
          obstructionDistance: obstruction ? round(obstruction.distance) : null });
        state.swing = null; state.swingRetryAfter = state.elapsed + .2; attachedAt = null;
      } else if (excess > 0 && excess <= .5 && state.swing.ropeLength + excess <= state.swing.maximumLength) state.swing.ropeLength += excess;
    } else if (attachedAt !== null) {
      longestAttachment = Math.max(longestAttachment, frame - attachedAt); attachedAt = null;
    }
    refreshTraversalContext(state, input);
    const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
    maxSpeed = Math.max(maxSpeed, speed); maxHeight = Math.max(maxHeight, state.position.y);
    distance += before.distanceTo(hit.position); contacts += hit.contacts; wallFrames += +Boolean(hit.wallNormal);
    airFrames += +!state.grounded; swingFrames += +Boolean(state.swing);
    if (frame > 30 && speed < 1 && held) stalled++;
    const clear = world.isCapsuleClear(state.position, .46, 2.05, false);
    if (!clear) {
      penetrationFrames++;
      if (sampleFailures.length < 12) sampleFailures.push({ frame, point: coordinates(state.position), exactPoint: { ...state.position },
        previousPoint: coordinates(before), velocity: coordinates(state.velocity), speed: round(speed), grounded: state.grounded, contacts: hit.contacts,
        surfaceClear: world.isCapsuleClear(state.position, .46, 2.05, false), fullClear: world.isCapsuleClear(state.position),
        support: support ? { point: coordinates(support.point), normal: coordinates(support.normal), capsuleY: supportY } : null,
        preFinalSnapPoint: coordinates(preFinalSnapPosition), preFinalSnapClear: world.isCapsuleClear(preFinalSnapPosition, .46, 2.05, false) });
    }
    assert.ok(Number.isFinite(speed + state.position.x + state.position.y + state.position.z), 'Finite integrated state');
    assert.equal(state.wallCrawlActive, false, 'an active swing collision cannot steal control into wall crawl');
    times.push(performance.now() - tickStart);
  }
  if (attachedAt !== null) longestAttachment = Math.max(longestAttachment, frameCount - attachedAt);
  times.sort((a, b) => a - b);
  failures += penetrationFrames;
  return { trial: name, frames: frameCount, start, end: coordinates(state.position), distance: round(distance), maxHeight: round(maxHeight),
    maxSpeed: round(maxSpeed), airtimeSeconds: round(airFrames / 60), swingSeconds: round(swingFrames / 60),
    longestAttachmentSeconds: round(longestAttachment / 60), immediateDetaches, stalledHeldFrames: stalled,
    contacts, wallFrames, groundSkims, wallSkims, penetrationFrames, assistanceFrames, probes, anchorSearches: searches,
    meanAnchorCandidates: round(anchorCount / Math.max(1, searches)), events, detaches, detachSamples, sampleFailures,
    cpuFrameMeanMs: round(times.reduce((sum, value) => sum + value, 0) / times.length), cpuFrameP95Ms: round(times[Math.floor(times.length * .95)]) };
}

for (const config of DISTRICTS.filter(map => wanted.has(map.id))) {
  const bytes = fs.readFileSync(new URL(`../public${config.model}`, import.meta.url));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const embedded = []; gltf.scene.traverse(object => { if (object instanceof THREE.SkinnedMesh) embedded.push(object); });
  for (const object of embedded) object.parent?.remove(object);
  const original = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
  const scale = config.targetWidth / Math.max(original.x, original.z, .001);
  gltf.scene.scale.setScalar(scale); gltf.scene.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(gltf.scene), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  gltf.scene.position.set(-center.x, -config.sourceGroundY * scale, -center.z);
  const root = new THREE.Group(); root.position.set(...config.position); root.rotation.y = config.rotation ?? 0; root.add(gltf.scene);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(size.x + 12, .28, size.z + 12), new THREE.MeshBasicMaterial());
  floor.position.y = -.16; root.add(floor); root.updateWorldMatrix(true, true);
  const query = await WorldMeshQuery.fromObject(root);
  const sine = Math.abs(Math.sin(root.rotation.y)), cosine = Math.abs(Math.cos(root.rotation.y));
  const world = new RepeatingMeshWorld(query, Math.max(8, size.x * cosine + size.z * sine + 8), Math.max(8, size.z * cosine + size.x * sine + 8));
  if (config.id === 'new-york-city') {
    // Recorded browser case: broad sidewalk support was surface-clear but the
    // old four-horizontal-ray interior test reported a closed building.
    const point = new THREE.Vector3(-20.667455178663992, .17205911469459534, 7.071229271271642);
    const center = point.clone().add(new THREE.Vector3(0, 2.05 * .5, 0));
    const volumeNames = [];
    root.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || !object.geometry.getAttribute('position')) return;
      for (let i = 0; i < (object instanceof THREE.InstancedMesh ? object.count : 1); i++) volumeNames.push(object.name);
    });
    const rays = [];
    for (const axis of [[1,.00013,.00031],[-1,-.00013,-.00031],[.00017,.00011,1],[-.00017,-.00011,-1],[.00013,1,.00017],[-.00013,-1,-.00017]]) {
      const direction = new THREE.Vector3(...axis).normalize(), origin = center.clone(), byVolume = new Map();
      for (let step = 0; step < 400; step++) {
        const hit = query.raycast(origin, direction, 1000); if (!hit) break;
        const volume = query.volumes[hit.triangleIndex];
        const distances = byVolume.get(volume) ?? []; distances.push(round(hit.point.distanceTo(center))); byVolume.set(volume, distances);
        origin.copy(hit.point).addScaledVector(direction, .006);
      }
      rays.push({ axis, oddVolumes: [...byVolume].filter(([, hits]) => hits.length % 2).map(([volume, distances]) => ({ volume, name: volumeNames[volume], distances })) });
    }
    console.log(JSON.stringify({ recordedBrowserPoint: coordinates(point), surfaceClear: world.isCapsuleClear(point, .46, 2.05, false), fullClear: world.isCapsuleClear(point), rays }, null, 2));
  }
  const routes = streetRoutes(world);
  console.log(JSON.stringify({ map: config.id, triangles: query.triangleCount, textureDecoding: false,
    trials: routes.map((route, index) => simulate(world, route, ['central-street', 'cross-street', 'unrendered-repeat-tile'][index])) }, null, 2));
}
assert.equal(failures, 0, 'Every integrated frame must remain outside rendered mesh surfaces/interiors.');
console.log('PASS: integrated map trials had no penetrations or automatic wall crawling. Airtime/detach/performance metrics above remain diagnostic, not a claim of visual polish.');
