import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DISTRICTS } from '../lib/game-config.ts';
import { WorldMeshQuery, capsuleSupportHeight } from '../lib/mesh-world.ts';
import { RepeatingMeshWorld } from '../lib/repeating-mesh-world.ts';
import { probeWallFeet } from '../lib/wall-surface.ts';
import { createSwingAssistanceState, stepSwingAssistance } from '../lib/swing-assistance.ts';
import { createTraversalState, stepTraversalInPlace, setTraversalKinematics, refreshTraversalContext, acceptTraversalWallContact, resolveSwingContinuation, commitAdvancedMotion } from '../lib/traversal-physics.ts';

import { ADVANCED_TRAVERSAL_CONFIG as config } from '../lib/traversal-advanced.ts';

// Geometry/physics integration, not texture or browser FPS verification. This
// intentionally mirrors SpiderGame's force -> swept mesh -> support -> rope
// validation order, including real elevated anchors and independent swing input.
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(parser => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'integrated_swing_skip_images', loadTexture: () => Promise.resolve(new THREE.Texture()) };
});
const wanted = new Set(process.argv.slice(2).length ? process.argv.slice(2) : DISTRICTS.map(map=>map.id));
for (const id of wanted) assert.ok(DISTRICTS.some(map=>map.id===id), `Unknown map ${id}`);
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
  const frameCount = name === 'central-street' ? 1920 : 720;
  const state = createTraversalState(route.point), assistance = createSwingAssistanceState();
  state.grounded = true;
  const forward = route.forward, aim = forward.clone().add(new THREE.Vector3(0, .18, 0)).normalize();
  const times = [], events = {}, detaches = {}, sampleFailures = [], detachSamples = [];
  let airFrames = 0, swingFrames = 0, contacts = 0, wallFrames = 0, stalled = 0, penetrationFrames = 0;
  let distance = 0, maxHeight = state.position.y, maxSpeed = 0, assistanceFrames = 0, probes = 0;
  let anchorCount = 0, searches = 0, attachedAt = null, longestAttachment = 0, immediateDetaches = 0, groundedReleases = 0;
  let cachedAnchors = [], nextSearch = 0, previousHeld = false, currentStall = 0, maximumStall = 0;
  const stallSamples=[];
  const start = coordinates(state.position);
  for (let frame = 0; frame < frameCount; frame++) {
    const tickStart = performance.now(), dt = 1 / 120;
    const held = frameCount > 720 ? frame % 402 < 360 : frame >= 16 && frame < 336 || frame >= 412 && frame < 640;
    const input = { move: forward, cameraForward: forward, aimDirection: aim, wallClimb: 1,
      jumpPressed: !held && (frame === 0 || frame === 396), jumpHeld: false,
      swingHeld: held, swingPressed: held && !previousHeld, swingReleased: !held && previousHeld,
      diveHeld: false, reel: 0 };
    previousHeld = held;
    let candidates = [];
    if (!state.swing && !state.zip && held) {
      if (frame >= nextSearch) {
        const speed = Math.hypot(state.velocity.x, state.velocity.z);
        const heading = speed > 8 ? new THREE.Vector3(state.velocity.x, 0, state.velocity.z).normalize() : forward;
        cachedAnchors = anchorsAt(world, state.position, heading); nextSearch = frame + 10;
        searches++; anchorCount += cachedAnchors.length;
      }
      candidates = cachedAnchors;
    }
    const assisted = stepSwingAssistance(assistance, { position: state.position, velocity: state.velocity, dt,
      swinging: Boolean(state.swing && held), diving: false, desiredDirection: forward },
    (origin, direction, maximum) => world.raycast(origin, direction, maximum));
    probes += assisted.probeCount; assistanceFrames += +assisted.active;
    const before = new THREE.Vector3().copy(state.position), wasGrounded = state.grounded;
    let incoming = { ...state.velocity };
    const result = stepTraversalInPlace(state, input, {
      groundY: -10000, colliders: [], anchorColliders: [], wallContact: state.wall, externalCollision: true,
      predictiveAssistAcceleration: assisted.acceleration,
      sampleGround: (point, rise, drop) => world.supportAt(point, rise, drop ?? .1)?.point.y ?? null,
      anchorCandidates: candidates, zipTargets: candidates,
    }, dt, config);
    for (const event of result.events) {
      events[event.type] = (events[event.type] ?? 0) + 1;
      if (event.type === 'web-attached') attachedAt = frame;
      if (event.type === 'web-released' && attachedAt !== null) {
        longestAttachment = Math.max(longestAttachment, frame - attachedAt); attachedAt = null;
      }
    }
    incoming = { ...state.velocity };
    const hit = world.sweepCapsule(before, state.position, state.velocity);
    const preFinalSnapPosition = hit.position.clone();
    const blocked = Boolean(hit.wallNormal) || hit.blocked && !hit.grounded;
    const support = hit.velocity.y <= .1 ? world.supportAt(hit.position, .015, .51) : null;
    const supportY = support ? capsuleSupportHeight(support) : null;
    state.grounded = supportY !== null && Math.abs(hit.position.y - supportY) < .045;
    if (state.grounded) {
      // Mirror SpiderGame: a nearby sloped support must not snap through another face.
      const beforeSnap = hit.position.y;
      hit.position.y = supportY;
      if (world.isCapsuleClear(hit.position, .46, 2.05, false)) {
        hit.velocity.y = Math.max(0, hit.velocity.y); state.airSeconds = 0;
      } else { hit.position.y = beforeSnap; state.grounded = false; }
    }
    if (!wasGrounded && state.grounded) state.landingSeconds = .16;
    setTraversalKinematics(state, hit.position, hit.velocity);
    const normal = hit.wallNormal ?? state.wall?.normal;
    const contact = normal ? probeWallFeet(state.position, normal, (origin, direction, max) => world.raycast(origin, direction, max)) : null;
    if (contact) { state.wall = { ...contact, contactSeconds: state.wall?.contactSeconds ?? 0, graceSeconds: .14 }; acceptTraversalWallContact(state, contact, incoming, input, config); }
    else { if(state.wallRunActive && held)state.swingNeedsRelease=false; state.wall = null; state.wallCrawlActive = false; state.wallRunActive = false; }
    if (state.swing) {
      const anchor = new THREE.Vector3().copy(state.swing.visualAnchor ?? state.swing.anchor);
      const pivot = new THREE.Vector3().copy(state.swing.simulationPivot ?? state.swing.pivot ?? state.swing.anchor);
      const chest = hit.position.clone().add(up), line = anchor.clone().sub(chest);
      const obstruction = world.raycast(chest, line.clone().normalize(), Math.max(0, line.length() - .1));
      const excess = hit.position.distanceTo(pivot) - state.swing.ropeLength;
      const conflict = blocked && excess > Math.max(.25, state.swing.ropeLength * .01);
      const previousRopeLength = state.swing.ropeLength;
      const resolution = resolveSwingContinuation(state, {
        obstruction: obstruction ? { point: obstruction.point, normal: obstruction.normal, id: `mesh:${obstruction.triangleIndex}` } : null,
        constraintBlocked: conflict, contact, candidates: obstruction || conflict ? anchorsAt(world,state.position,forward) : cachedAnchors, dt,
        hasLineOfSight: (origin,target) => {
          const a = new THREE.Vector3().copy(origin).add(up), d = new THREE.Vector3().copy(target).sub(a);
          return !world.raycast(a,d.clone().normalize(),Math.max(0,d.length()-.12));
        },
      }, input, config, result.events);
      if (resolution === 'landed') { groundedReleases++; attachedAt=null; }
      if (resolution === 'detach') {
        detaches['no-valid-continuation'] = (detaches['no-valid-continuation'] ?? 0) + 1;
        if (attachedAt !== null) {
          longestAttachment = Math.max(longestAttachment, frame - attachedAt);
          if (frame - attachedAt < 24) immediateDetaches++;
        }
        if (detachSamples.length < 8) detachSamples.push({ frame, reason: resolution, age: attachedAt === null ? null : frame - attachedAt,
          position: coordinates(hit.position), velocity: coordinates(hit.velocity), rope: round(previousRopeLength), excess: round(excess),
          obstructionDistance: obstruction ? round(obstruction.distance) : null });
        attachedAt = null;
      }
    } else if (attachedAt !== null) {
      longestAttachment = Math.max(longestAttachment, frame - attachedAt); attachedAt = null;
    }
    commitAdvancedMotion(state,input,config,dt,result.events);
    refreshTraversalContext(state, input, config);
    const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
    maxSpeed = Math.max(maxSpeed, speed); maxHeight = Math.max(maxHeight, state.position.y);
    distance += before.distanceTo(hit.position); contacts += hit.contacts; wallFrames += +Boolean(hit.wallNormal);
    airFrames += +!state.grounded; swingFrames += +Boolean(state.swing);
    if (frame > 30 && speed < 1 && held) {
      stalled++; currentStall++; maximumStall=Math.max(maximumStall,currentStall);
      if(stallSamples.length<8 || currentStall===42 || currentStall===120)stallSamples.push({frame,mode:state.mode,position:coordinates(state.position),velocity:coordinates(state.velocity),wall:state.wall,advanced:structuredClone(state.advanced),needsRelease:state.swingNeedsRelease,anchorCandidates:candidates.length});
    } else currentStall=0;
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
    if (state.wallCrawlActive || state.wallRunActive) assert.ok(state.wall?.feetTouching, 'Automatic wall traversal requires measured feet contact');
    times.push(performance.now() - tickStart);
  }
  if (attachedAt !== null) longestAttachment = Math.max(longestAttachment, frameCount - attachedAt);
  times.sort((a, b) => a - b);
  failures += penetrationFrames;
  assert.equal(immediateDetaches, 0, 'Geometry recovery must not kill a newly caught swing');
  if(maximumStall>=42)console.log(JSON.stringify({trial:name,maximumStall,stallSamples},null,2));
  assert.ok(maximumStall < 42, 'Held traversal must not stall against a facade for .35 continuous seconds');
  if(Object.keys(detaches).length)console.log(JSON.stringify({trial:name,detaches,detachSamples},null,2));
  assert.equal(Object.values(detaches).reduce((a,b)=>a+b,0), 0, 'Street/corner courses have valid continuations');
  return { trial: name, frames: frameCount, start, end: coordinates(state.position), distance: round(distance), maxHeight: round(maxHeight),
    maxSpeed: round(maxSpeed), groundedReleases, airtimeSeconds: round(airFrames / 120), swingSeconds: round(swingFrames / 120),
    longestAttachmentSeconds: round(longestAttachment / 120), immediateDetaches, stalledHeldFrames: stalled, maximumConsecutiveStallFrames: maximumStall,
    contacts, wallFrames, penetrationFrames, assistanceFrames, probes, anchorSearches: searches,
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
  const report = { map: config.id, triangles: query.triangleCount, textureDecoding: false, simulationHz:120,
    trials: routes.map((route, index) => simulate(world, route, ['central-street', 'cross-street', 'unrendered-repeat-tile'][index])) };
  fs.writeFileSync(new URL(`../docs/verification/traversal-continuity-${config.id}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
assert.equal(failures, 0, 'Every swept integrated frame must remain outside rendered mesh surfaces. Spawn interior validation is checked separately.');
console.log('PASS: integrated map trials had no capsule penetrations; wall traversal requires physical contact. Airtime/detach/performance metrics above remain diagnostic, not a claim of visual polish.');
