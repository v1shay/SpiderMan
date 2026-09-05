# Contextual traversal implementation and validation

## Runtime architecture

- `SpiderTraversalMotor` is the only gameplay transform/collision authority. It owns every `CharacterController.Move`, gravity, landing prediction, 6 cm safe substeps, residual penetration recovery, wall-run velocity, impact dissipation, hang hold, and explicit teleport/reset. Ground state is re-probed from geometry after teleports rather than trusting Unity's stale cached `isGrounded` bit. The Animator always has root motion disabled.
- `TraversalContextProbe` derives obstacle, support, roof-edge, roll-corridor, ceiling, lower-body wall contact, wall-incidence/corridor, and ledge facts from physics geometry. Selection does not inspect object names.
- `TraversalAnimationCatalog` describes semantic family, legal predecessors/successors, protected/contact/rotation windows, playback limits, geometry requirements, momentum behavior, and content blockers.
- `TraversalCandidateSelector` hard-rejects unsafe candidates before deterministic scoring. Identical seed/context/event input is replay-stable. Recent-repeat and seeded variety affect only surviving clips in the requested semantic family.
- `SpiderTraversalAnimationDriver` coordinates locomotion, takeoff, tricks, falling, landings/rolls, vaults, wall actions, hangs, and swing-only clips through the metadata graph. Forward intent always uses `Running`; the former walk-to-run delay is removed. A roll is committed once, never followed by a second automatic roll-looking clip. Extreme-drop scoring includes safe remaining chain capacity, so long clear falls use multiple non-repeating complete flips when time allows. It does not move the player.
- `SpiderTraversalContactFitter` applies bounded hand contact correction only inside annotated contact windows. `SpiderFootGrounding` remains responsible for limited foot/pelvis correction on uneven surfaces.
- `SpiderTraversalCamera` uses one continuous speed-driven response across traversal states, with smoothed FOV/follow distance, restrained roll, acceleration-limited focus, a bounded collision-boom release, and a player-side deep-occlusion fallback. Generic jumps/landings never inject camera recoil. `SpiderTraversalSpeedBlur` emits short deterministic wind pulses at takeoff/double-jump or exceptional acceleration and returns fully clear during sustained airtime.

The current New York hierarchy contains 31 renderable triangle meshes and 31 matching enabled,
non-trigger MeshColliders. Physics back-face queries are enabled so reversed triangle winding does
not create one-way facades. The coverage claim applies to every authored triangle; deliberately
empty holes or absent source geometry cannot be made solid without changing the model.

## Explicit content blockers

The selector logs these as unavailable and uses a safe existing fallback:

- `Running Crawl` and `Low Crawl`: source clips exist, but validated enter and exit animations do not. Both contextual crawl behaviors remain disabled instead of forcing a snap.
- `Jumping To Hanging`: safe hang entry exists, but no proper mantle/top-out source animation exists. The system holds/falls safely and does not fake a climb with an unrelated clip.
- `Standing Using Touchscreen Tablet`: the available source is a long standing animation with no validated airborne excerpt or contact envelope, so it is not inserted into long-fall chains.
- `Stylish Flip`: its source pose reads as swing-like and is prohibited from generic jump/fall selection.
- Combat/evade clips not classified as traversal remain unavailable to the autonomous selector.

## Automated validation outputs

- `Temp/TraversalValidation/runtime-report.json`: live CharacterController, city collision, foot grounding, jump/double-jump, long-fall, landing, camera, ceiling, wall, 8 FPS, and respawn checks.
- `Temp/TraversalValidation/contextual-regression-report.json`: deterministic threshold sweeps, prohibited-state checks, replay tests, and seeded physically plausible fuzz cases.
- `Temp/TraversalValidation/contextual-regression-table.csv`: one machine-readable row per contextual case and safety invariant.
- `Temp/TraversalValidation/full-animation-batch-report.json`: aggregate per-clip, transition, chain, and contextual result.
- `Temp/TraversalValidation/full-animation-clip-table.csv`: one row per imported library animation and every clip metric.
- `Temp/TraversalValidation/full-animation-transition-table.csv`: every legal metadata edge, including an actual fresh-instance Animator crossfade exercise.
- `Temp/TraversalValidation/AnimationFailureTraces/` and `ContextualFailureTraces/`: deterministic failure traces; stale traces are cleared at the start of each unattended run.

Current accepted baseline uses deterministic seed `2099`.

Latest unattended baseline (2026-09-04): 59/59 clips passed, 9,997 individual
animation samples passed, 368/368 legal transitions passed, and 2,601/2,601 contextual
threshold/fuzz cases passed. Live runtime validation passed with a 100 m
`Backflip -> Falling -> Front Flip` chain, one roll entry, detected lower-body wall run,
bounded motion-blur pulses, zero sampled camera/world overlaps, and all 31/31 city collision
meshes covered. Additional real-city facade sweeps cover valid wall runs, blocked overhang exits,
reversed-winding collision, post-contact escape, and camera near-plane/mesh separation. The
21-facade sweep produced 14/14 actual wall-run clips on safe geometry, seven deterministic
low-clearance rejections, 21/21 successful post-contact escapes, and zero penetration, camera
overlap, or camera near-plane crossings.
