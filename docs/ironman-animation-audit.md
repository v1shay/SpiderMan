# Iron Man native-animation audit

## Asset and review

The newly downloaded `15_iron_man_mua.glb` replaces the old Mark 85 as the existing Iron Man option. The original download and old GLB are retained. The runtime asset is `public/assets/suits/ironman-mua.glb`: 6,340,032 bytes, 4,253 vertices, one skinned mesh, five embedded images and 36 authored clips. All 20 anatomical rig roles map successfully.

All 36 clips were visually reviewed in the local contact-sheet viewer, not classified from names alone. Open `/scripts/ironman-preview.html` on the development server for nine pages of original clips, or switch to gameplay poses for two pages of chained transitions. The viewer is a development script, not a production route.

## Clip-by-clip decisions

| Original clip | Visual assessment and use |
| --- | --- |
| `idle` | Authored ready stance; retained. Calmer `menu_idle` is the standing baseline. |
| `jump_loop` | Two-key near-static tucked pose; retained, not used as a full moving airborne loop. |
| `jump_start` | Upward reach and leg tuck; native jump plus 0.50–1.10s drift section. |
| `menu_action` | Short standing gesture; periodic selected-lobby emote. |
| `menu_goodbye` | Raised-hand gesture; selected-lobby greeting. |
| `menu_idle` | Relaxed standing stance; grounded gameplay and lobby baseline. |
| `attack_heavy1` | Upward fist and knee motion; 0.10–0.333s aerial re-ignition boost. |
| `attack_knockback1` | Combat reaction; retained, excluded from traversal. |
| `attack_knockback2` | Combat reaction; retained, excluded from traversal. |
| `attack_light1` | Punch sequence; retained, excluded from traversal. |
| `attack_light2` | Low punching/crouch; retained, excluded from traversal. |
| `attack_light3` | Turning attack follow-through; retained, excluded from traversal. |
| `attack_stun2` | Stun/attack motion; retained, excluded from traversal. |
| `attack_trip1` | Low trip attack; retained, excluded from traversal. |
| `blocking` | Defensive guard; retained, excluded from traversal. |
| `fly_fast` | Native fast-flight loop; cruise above 50m/s or boost. |
| `fly_idle` | Native upright repulsor hover; stationary hover. |
| `fly_slow` | Native low-speed flight; moving hover, slow cruise and short ignition transition. |
| `pain_blocking` | Brief block reaction; retained, excluded from traversal. |
| `power_1` | Aiming/attack gesture; retained, excluded from traversal. |
| `power_12` | Aiming stance; retained, excluded from traversal. |
| `power_13` | Upward launch extension; 0.15–0.74s takeoff rise. |
| `power_14` | Upward power gesture; 0.16–0.48s cruise boost transition, retaining forward pitch. |
| `power_1_end` | Attack recovery; retained, excluded from traversal. |
| `power_1_loop` | Sustained attack posture; retained, excluded from traversal. |
| `power_2` | Attack/aiming motion; retained, excluded from traversal. |
| `power_3` | Short aiming motion; retained, excluded from traversal. |
| `power_4` | Extended attack stance; retained, excluded from traversal. |
| `power_5` | Crouch/compression followed by rise; 0.12–0.50s takeoff coil. |
| `power_6` | Kneeling ground-attack recovery; 0.62–1.20s grounded landing recovery. |
| `power_7` | Knee curl; 0.60–1.17s tuck when cutting repulsors. |
| `power_8` | Aiming/shooting sequence; retained, excluded from traversal. |
| `power_9` | Disappearing/underground frames near two-thirds of clip; explicitly excluded from traversal. |
| `victim1` | Collapse/death motion; retained, excluded from traversal. |
| `zone_stark1.zone10` | Standing scene animation; retained, unnecessary for traversal. |
| `zone_stark2.zone5` | Long conversational gestures; retained, not used in short flight transitions. |

## Runtime behavior

- Ground takeoff: compression → rising launch → ignition → native hover/cruise.
- Midair re-ignition: upward boost → ignition → native hover/cruise.
- Cruise boost: short power gesture → fast flight, keeping the forward lean.
- Power cut: knee tuck → native drift segment, repulsors off and ordinary gravity restored.
- Ground contact: kneeling recovery → standing idle. Movement or another launch cancels recovery.
- Standing/lobby use native menu animations; the pack has no running clip, so walking/running uses the model's own mapped rig procedurally.

All 36 originals remain available. Eight derived clips preserve sections of their original curves. Actor/Motion root and hips translation are removed so authored root motion cannot displace the collision capsule; joint rotations remain native. The forward-axis correction is model-specific. A local-axis cruise pitch makes Iron Man lean forward at every heading, rather than pitching sideways after a turn.

Four small repulsor emitters follow the animated palms and boots. Local and remote Iron Man avatars use the same native animation graph. Network mode names carry hover/cruise/boost/freefall through the existing mode field; no database schema changes are required.

## Controls

- WASD: ground movement / aerial steering.
- Arrow keys: view and cruise heading.
- Space: ascend; preserves cruise when already cruising.
- F: hover on; another press cuts power into freefall. Repress to recover.
- E or quick mouse click: toggle cruise.
- Hold mouse while cruising: boost and aim. A hold does not toggle cruise off on release.
- Shift: descend when powered; does not switch on flight from the ground.

## Verification

`npm run test:ironman` verifies 36 retained source clips, 5,827 source-curve samples and 413 full-mesh poses, grounded contact, launch cancellation, all flight chains, boost/hover/freefall inputs, four jet attachments, four heading orientations and boosted collision against a wall using the same traversal solver.

Also passed: Pavitr native-animation tests (27,146 source comparisons), ten-model motion tests (172,269 checks), roster tests, 540 full-mesh wall poses, and 30 deterministic traversal cases. TypeScript, lint and a production build passed.

Browser inspection on localhost verified the textured new model in the lobby and on the rooftop, F takeoff (`coil` then `fly_idle`), E cruise (`fly_fast`), F power-cut (`tuck`), quick F recovery (`boost`), and the closer flight camera. Browser error log was empty at the check. This does not certify every collision in every map, every device's frame rate, or a live two-client Iron Man session. Production has not been deployed by this change.

The React review kept animation/jet updates in the imperative game loop rather than per-frame React state, retained the existing event listener cleanup, and kept the control hint conditional on the selected hero.
