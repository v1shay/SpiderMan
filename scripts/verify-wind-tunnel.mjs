import assert from 'node:assert/strict';
import { stepWindTunnels } from '../lib/wind-tunnel.ts';

const tunnel = { center: { x: 0, y: 10, z: 0 }, direction: { x: 0, y: 0, z: -1 }, halfLength: 20, radius: 6, acceleration: 42, maximumSpeed: 92 };
const inside = stepWindTunnels({ x: 0, y: 10, z: 5 }, { x: 3, y: 0, z: -20 }, [tunnel], .5);
assert.equal(inside.active, 0);
assert.ok(inside.velocity.z < -39 && Math.abs(inside.velocity.x) < 3, 'tunnel adds forward speed and aligns lateral drift');
const edge = stepWindTunnels({ x: 5.5, y: 10, z: 5 }, { x: 0, y: 0, z: -20 }, [tunnel], .5);
assert.ok(edge.velocity.z > inside.velocity.z, 'edge boost is weaker than center boost');
const outside = stepWindTunnels({ x: 7, y: 10, z: 5 }, { x: 0, y: 0, z: -20 }, [tunnel], .5);
assert.equal(outside.active, -1);
assert.deepEqual(outside.velocity, { x: 0, y: 0, z: -20 });
const reverse = stepWindTunnels({ x: 0, y: 10, z: 5 }, { x: 0, y: 0, z: 12 }, [tunnel], .5);
assert.equal(reverse.strength, 0, 'wrong-way entry never flips velocity through a wall-sized volume');
console.log('Wind tunnel boost verification passed.');
