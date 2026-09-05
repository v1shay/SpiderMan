# Contextual traversal animation research and inventory

Research date: 2026-09-03  
Project: `/Users/agarwal/spiderMan`  
Scope: research and inventory only; nothing described below was implemented.

## Executive answer

Yes. The current library is large enough to build a useful, varied contextual traversal director. It can already cover:

- grounded forward/back/strafe locomotion and turns;
- standing, moving, and running takeoffs;
- short jumps, long running gaps, double-jump flips, and multi-stage long-drop tricks;
- ordinary, rolling, and run-through landings;
- one likely HVAC/roof-obstacle vault;
- low-clearance crawl behavior;
- ledge catch, wall run, wall crash, and swing-specific wall arrival candidates;
- idle and long-airtime flourish variation.

The correct first architecture is not an opaque AI model. It is a data-driven candidate generator plus hard safety gates, trajectory/pose scoring, authored contact windows, and deterministic weighted variation. That matches the most transferable ideas in Insomniac's published work: geometry-aware candidate selection, assisted physics, pose-matched/data-authored transitions, segmented animations, and continuity of momentum.

The current clips are not enough to make every rooftop case look bespoke. The largest content gaps are mantle/top-out, perch, wall-run direction variants, several obstacle-vault sizes, slide/duck transitions, and clean left/right wall-impact recoveries. The system must reject a context when no clip fits instead of forcing a visually wrong animation.

## What was found

The detailed row-by-row audit is in [mixamo-animation-inventory.csv](./mixamo-animation-inventory.csv).

| Location | Files | Relationship |
|---|---:|---|
| `Assets/Animations/Mixamo` | 58 FBX | Imported source library; all 58 contents are unique |
| `mixamo_animations` | 43 FBX | Exact archive copies of 43 imported files |
| `/Users/agarwal/Downloads` | 17 FBX | 15 exact imported duplicates plus two non-identical same-labeled files |
| `Assets/SpiderManSystem/Generated/Clips` | 16 `.anim` | Generated/sanitized derivatives, not new Mixamo source motions |

There are **60 unique FBX byte contents** across the project and Downloads. That does not prove there are 60 motion-distinct animations: the two unimported same-labeled Downloads files must be compared at the clip-curve level.

Two Downloads files are not byte duplicates of their same-labeled imported counterparts:

- `X Bot@Running Forward Flip.fbx` is newer and byte-different from the imported/project-root copy even though both are 375,280 bytes.
- `Run To Rolling.fbx`, detected in a final recursive scan after it was added on September 3, is 2,012,720 bytes and content-different from the 539,360-byte imported `X Bot@Run To Rolling.fbx`; the size difference may partly reflect included FBX character data rather than different motion.

This research did not import or replace either file.

Unity's live AssetDatabase reported that all 58 imported clips:

- are 30 fps Humanoid clips;
- expose root curves;
- have durations from 0.033 to 33.133 seconds;
- have no serialized import warnings.

Unity presently reports zero `AnimationClip.averageSpeed` for every imported clip under the current setup. Contextual selection therefore cannot infer intended travel distance from that property; each clip needs a separately measured or authored motion/contact profile.

“Driver reference” in the CSV means the current traversal source code names the clip. It is not a claim that this research replayed every behavior. The current driver references 23 of the 58 imported sources plus the generated `Backflip`; swing-named clips are deliberately blocked from its generic jump/ground path.

## What Insomniac's published design actually establishes

Doug Sheahan's 2019 Insomniac traversal talk is unusually relevant. Insomniac moved beyond raw raycasts by generating building markup volumes and then used collision for final refinement. The selection process considered input, camera direction, velocity, wall facing, fall direction, ground proximity, and nearby openings. The same talk describes look-ahead assists for buildings and ground, dedicated moves for fire escapes/outcroppings, and an edge move that redirects velocity to maintain flow. [GDC session](https://www.gdcvault.com/play/1026084/Concrete-Jungle-Gym-Building-Traversal), [Insomniac slides](https://media.gdcvault.com/gdc2019/presentations/Sheahan_Doug_ConcreteJungleGym.pdf).

The animation portion is even more applicable:

- animation phase was tied to the physical swing arc;
- separate introductions were pose-matched into the main motion;
- partial animations aligned body and arms without duplicating every clip;
- a monolithic swing was split into pieces so the important kick could play at full speed and accept variants;
- animators annotated regions of active animations with data pointing to custom transitions, avoiding a hand-coded matrix of every clip pair.

This is strong evidence for a clip-metadata approach. It is not evidence that Insomniac used Unity, Mixamo, or a specific commercial motion-matching product.

The 2024 Spider-Man 2 talk defines the traversal pillars as Spider-Man identity, depth through momentum, breadth of action, and accessibility to a broad audience. Its web-wing solution combines physical forces with explicit assists: a near-ground steering/anti-gravity aid and forward/side wall tests that nudge toward openings and damp steering into walls. Its speed systems reward skill without arbitrarily slowing the player. [GDC session](https://www.gdcvault.com/play/1034327/Higher-Faster-Farther-Evolving-Traversal), [Insomniac slides](https://media.gdcvault.com/gdc2024/Slides/GDC+slide+presentations/Sheahan_Doug_Hig.pdf).

Official PlayStation coverage describes Spider-Man 2's faster traversal as weaving web swinging and Web Wings together rather than treating them as isolated replacements. That reinforces preserving velocity and a common camera/trajectory model across mode changes. [PS5 traversal overview](https://blog.playstation.com/2023/09/19/how-marvels-spider-man-2-taps-into-the-power-of-ps5/), [Insomniac State of Play details](https://blog.playstation.com/2023/09/14/marvels-spider-man-2-new-state-of-play-trailer-gameplay-details/).

The transferable lesson is: preserve player intent and momentum, use geometry to choose and fit authored action, assist failure cases invisibly, and never let animation become a second uncontrolled physics system.

## Proposed non-implemented architecture

### 1. Environment context probe

Build a short-lived `TraversalContext` every physics step from:

- player intent: move direction, jump/action input, camera-forward direction;
- motion: horizontal velocity, vertical velocity, acceleration, airborne time, jump count, current animation phase;
- predicted trajectory: time to apex, time/distance/drop to first valid landing, impact velocity;
- ground: normal, slope, left/right foot heights, support width, next edge distance;
- forward obstacle: distance, surface normal, approach incidence, height, depth, top surface, far-side landing, overhead clearance;
- side openings: left/right free corridors and their alignment with desired travel;
- wall/ledge: climbable face, edge position, hand reach, wall-run corridor, top-out clearance;
- presentation: camera visibility and whether the full limb envelope stays outside geometry.

Use shape casts for the character volume and limbs, not a single ray. `BoxCast`/capsule sweeps provide volume-aware hits in Unity. [Unity `Physics.BoxCast`](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Physics.BoxCast.html).

For the New York GLB, pair collision with semantic surface descriptors. Those descriptors may later be generated from mesh/collider geometry:

- `RoofSupport`
- `VaultableObstacle`
- `WallRunnable`
- `LedgeCatchable`
- `LowClearance`
- `SwingAttachable`
- `NoTraversal`

An HVAC unit should be recognized primarily by shape and support context—an isolated waist-height obstruction sitting on a roof with a clear top/far side—not only by object name. This lets the same rule work on vents, parapets, crates, and future city models.

### 2. Animation context profile

Every usable clip needs metadata independent of the character model:

- semantic tags: `Run`, `Takeoff`, `Vault`, `AerialTrick`, `Fall`, `Land`, `Roll`, `Wall`, `Hang`, `Crash`, `Emote`;
- entry and exit pose signatures;
- duration and cancelable/protected intervals;
- takeoff, hand-contact, foot-contact, rotation-complete, impact, compression, and stable-exit normalized times;
- intended speed, vertical velocity, jump count, obstacle height/depth, approach-angle, and drop ranges;
- authored displacement and facing change before in-place conversion;
- full body/limb clearance envelope sampled across the clip;
- required target points: body, left/right hand, left/right foot;
- mirror permission and handedness;
- legal predecessor/successor tags;
- cooldown/rarity weight.

This metadata is what makes the algorithm repeatable for new models. The animation choice remains the same; only Humanoid retargeting, avatar scale, sole offsets, hand reach, and IK limits are recalibrated for the new body.

### 3. Hard gates before scoring

Reject a clip immediately if any of these fail:

- insufficient time before predicted contact to finish its protected action plus a landing reserve;
- swept body/limb envelope intersects terrain;
- obstacle dimensions fall outside the annotated range;
- no valid exit support or roll corridor;
- required wall/ledge/web target is missing;
- current mode is incompatible—for example, never use `Swing To Land` outside a real swing state;
- clip would require excessive playback scaling;
- player intent contradicts the move strongly enough to feel stolen.

This is the most important rule. Variety is valuable only among safe candidates.

### 4. Score compatible candidates

A practical score is:

```text
score = intentFit
      + trajectoryFit
      + geometryFit
      + entryPoseFit
      + exitPoseFit
      + momentumContinuity
      + cameraReadability
      + varietyBonus
      - collisionRisk
      - timeWarpCost
      - recentRepeatPenalty
```

Use hard gates for safety and soft scoring for style. Select with deterministic weighted randomness among candidates close to the best score, then apply per-family cooldowns. A deterministic seed derived from traversal-event ID gives visible variety while keeping bugs replayable.

Do not let randomness switch move families. It may choose between two compatible flips; it must not replace a wall run with a kick or a standard landing with a swing landing.

### 5. Fit the animation to the trajectory

The motor owns collision, gravity, and canonical position. Animation presents that trajectory.

- Preserve normal playback speed during visually important flips, contacts, kicks, and impacts.
- Adjust anticipation or recovery segments modestly; do not squash the entire clip to arbitrary airtime.
- Start a stunt only when its rotation-complete time plus landing reserve fits before predicted impact.
- If airtime is longer than the action, blend through `Falling` or another annotated bridge pose, then commit the landing anticipation at the measured time.
- If airtime becomes shorter because terrain prediction changes, choose an early legal exit or skip the stunt; do not fold limbs to force completion.
- Map the clip's authored contact event to the world contact point. Unity's `Animator.MatchTarget` can match a body part within a normalized-time window, but it works only on the base layer, queues one target at a time, and requires root motion. A physics-authoritative controller therefore needs one clearly defined authority path rather than applying root motion and scripted translation twice. [Unity `Animator.MatchTarget`](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Animator.MatchTarget.html), [root-motion behavior](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Animator-applyRootMotion.html).
- Apply limited two-bone IK for actual hand/foot contacts and provide knee/elbow hints. IK cannot rescue a clip whose trajectory or obstacle class is fundamentally wrong. [Unity Two Bone IK](https://docs.unity3d.com/Packages/com.unity.animation.rigging@1.2/manual/constraints/TwoBoneIKConstraint.html).

### 6. Data-driven transition annotations

Instead of coding `if currentClip == X then play Y`, each source clip should expose legal transition windows such as:

```text
Running [0.10..0.85] -> Running Jump, Run To Flip, Jump Over
Running Jump [0.42..0.78] -> Falling, Front Flip, Running Forward Flip
Front Flip [rotationComplete..0.92] -> Falling, Falling To Landing
Falling [any] -> Falling To Landing, Falling To Roll, Jumping To Hanging
Wall Run [edgeApproach] -> missing WallTopOut clip
```

Entry/exit pose distance should be part of selection. That follows Insomniac's disclosed animator-authored transition data while remaining implementable with this project's own clips.

## Behavior matrix for this library

| Context | Primary candidates | Selection variables | Important restriction |
|---|---|---|---|
| Flat ground | `Walking`, `Running`, strafes, `Walk Backward` | input direction, speed, turn rate | stride/playback must agree with motor speed |
| Uneven/sloped roof | same locomotion clips plus foot/pelvis correction | ground normals and per-foot heights | do not change clips every time a foot sees a small height change |
| Low HVAC/parapet | `Jump Over` | obstacle height/depth, approach speed, top/far-side clearance | needs measured contact and root-travel profile |
| Long low obstruction | `Running Crawl` | overhead clearance length, entry speed | dedicated enter/exit transitions are missing |
| Slow low-clearance area | `Low Crawl` | headroom and crawl corridor | determine whether source is transition or locomotion |
| Short standing jump | `Jumping`, then `Falling` if needed | approach speed, airtime | never start a long flip without time reserve |
| Strong jump | `Big Jump` | input, speed, predicted height/time | annotate whether its 2.367 s includes non-airborne tails |
| Running short gap | `Running Jump` | speed, gap distance, landing time | preserve takeoff foot and momentum |
| Running long gap | `Running Forward Flip`, `Run To Flip` | horizontal distance, lower landing, available airtime | compare the distinct Downloads revision first |
| Double jump | generated `Backflip` or `Front Flip` | jump count, remaining airtime, clearance | full rotation must finish before landing reserve |
| Long drop | `Front Twist Flip`, `Butterfly Twirl`, `Front Flip`, then `Falling` | drop, time-to-impact, current pose, recent history | tricks are optional; landing safety wins |
| Extreme long drop flourish | annotated excerpt of `Standing Using Touchscreen Tablet` | very long remaining airtime and large clearance | standing silhouette is unsafe near geometry |
| Soft landing | `Falling To Landing` | vertical impact and horizontal speed | start from authored anticipation, finish recovery |
| Fast rolling landing | `Falling To Roll`, `Run To Rolling`, `Quick Roll To Run` | impact, forward speed, run intent, roll corridor | never roll into HVAC/parapet/edge |
| Reachable ledge | `Jumping To Hanging` | hand reach, edge height, incidence, low enough speed | no authored climb-up/hang-exit clip exists |
| Wall approach, flow possible | `Wall Run` | input, camera, incidence, speed, wall corridor | direction/loopability must be visually annotated |
| Direct building hit | `Wall Crash`; possibly `Getting Hit Backwards` | incidence, speed, stopping distance, damage policy | glancing contacts should redirect, not crash |
| Swing-to-wall | `Swing Into Wall` | actual web-line state and approach | illegal outside swing mode |
| Swing landing | four `Swing To Land` variants | arc phase, velocity, landing shape | illegal outside swing mode |

## Concrete selection examples

### Running toward an HVAC unit

1. Sweep the capsule forward along predicted travel.
2. Confirm the first hit is an isolated obstacle with roof support under both sides.
3. Sample obstacle top, far edge, overhead clearance, and the landing corridor.
4. If dimensions fit `Jump Over` and player continues forward, propose a vault.
5. Reject it if the clip envelope clips the unit, the far side is unsupported, or an immediate second obstacle blocks recovery.
6. Match the annotated body/hand contact window to the obstacle and keep the motor trajectory collision-safe.
7. If too low to vault but overhead space is constrained for a long corridor, consider `Running Crawl`; if too tall and a valid face/edge exists, consider `Wall Run` or `Jumping To Hanging`; otherwise stop/deflect.

### Airborne toward a building

1. Use a fan of forward and side shape casts over a short predicted horizon.
2. Compute incidence angle and open corridors.
3. For a glancing approach with a compatible wall and maintained input, nudge toward the opening or enter `Wall Run`.
4. For a near-normal, high-speed approach with no legal redirect, choose `Wall Crash` and reserve its stopping/contact distance.
5. `Swing Into Wall` is a separate candidate available only if the character is genuinely in a web-swing state.

This preserves the Spider-Man fantasy: geometry becomes an opportunity when a valid move exists, but the animation system does not teleport through a bad fit.

### Choosing a jump or fall animation

Use predicted time-to-impact as the primary clock and distance/drop/speed as style inputs:

- short time: takeoff then land; no trick;
- medium time: compact `Front Flip` if rotation and landing reserve fit;
- long forward gap: `Running Forward Flip` or `Run To Flip` based on entry pose and destination height;
- long vertical drop: a scored trick, `Falling` bridge, then landing anticipation;
- extreme time: multiple tricks separated by stable bridge poses, with a long-airtime flourish only in a large clear volume.

Re-evaluate the landing prediction continuously, but do not switch away during a protected contact/rotation interval. This gives responsiveness without half-finished flips.

## Why a rules-and-score system is preferable here

Fifty-nine source motions are enough for a semantic selector, but too sparse for robust full-body motion matching across arbitrary rooftop geometry. Motion matching becomes attractive after the library includes hundreds of consistently authored locomotion and traversal samples plus pose, trajectory, and contact features.

For the current library, a transparent score system has better properties:

- every rejected animation has an inspectable reason;
- exact gameplay events can be replayed deterministically;
- collision safety is a hard rule rather than learned behavior;
- new clips can be added by authoring metadata rather than rewriting the selector;
- new Humanoid models reuse the same context profiles while recalibrating body measurements;
- animation bugs can be isolated to source motion, retargeting, contact fitting, or selection logic.

## Coverage gaps and acquisition priorities

Before expecting PS5-quality breadth, add or author these in order:

1. low, medium, and high vault variants with explicit hand/foot contacts;
2. ledge mantle/top-out, hang idle, hang shimmy, and drop-from-hang;
3. vertical and horizontal wall-run loops plus left/right entries, corners, and exits;
4. roof-edge step-over and high-speed roof-edge launch;
5. slide/duck enter-loop-exit set for low-clearance traversal;
6. glancing wall redirects left/right and direct wall impacts at multiple speeds;
7. stumble/recovery clips that preserve low-speed player control;
8. slope-aware start/stop/turn locomotion or sufficient stride-warp data;
9. multiple non-swing aerial neutral poses and short transition clips;
10. dedicated perch/point-launch animations if those mechanics are planned.

The existing `Jump Over`, `Wall Run`, `Jumping To Hanging`, `Wall Crash`, landing/roll family, and running flip family are the best clips to annotate first because they unlock distinct geometry-aware behavior rather than cosmetic variety alone.

## Required offline annotation and validation before implementation

The CSV's semantic assignment is based on imported metadata, filenames, existing source-code references, and previously documented project observations. Filenames are not sufficient for final use. Each candidate needs a future authorized review that records:

- contact events frame by frame;
- body and limb swept bounds;
- authored root displacement before sanitation;
- entry/exit pose signatures;
- mirrored-pose safety;
- retargeted knee/elbow bend direction;
- minimum airtime or obstacle dimensions;
- ground penetration and clearance margins;
- whether the clip includes takeoff, in-air action, landing, and recovery—or only some phases.

The unimported Downloads versions of `Running Forward Flip` and `Run To Rolling` should be quarantined and compared side by side before either canonical project clip is changed.

## Later implementation acceptance criteria

When implementation is authorized, the contextual system should not be accepted until automated event traces and frame-by-frame visual captures prove:

- zero capsule/body penetration across all tested obstacle and landing paths;
- no clip starts unless its protected action and landing reserve fit the predicted trajectory;
- no swing-named clip occurs outside a real swing state;
- HVAC vault contacts occur inside their authored windows and clear the far side;
- glancing wall approaches preserve flow while direct impacts stop safely;
- hard landing rolls require a clear corridor and never roll off an edge unintentionally;
- the same recorded input/context seed produces the same animation decision;
- variation avoids immediate repetition without choosing a lower-safety candidate;
- a newly imported Humanoid model passes the same scenarios after automatic scale/contact calibration;
- camera speed/FOV behavior stays continuous across move changes.

## Conclusion

The project can support a convincing first-generation contextual traversal algorithm with the animations already present. The essential work is not adding more `if` statements; it is building trustworthy context data and trustworthy clip annotations, then selecting only among geometrically and temporally valid motions.

That approach follows the documented Insomniac philosophy without pretending to reproduce proprietary code: physics provides continuity, player intent controls direction, environment analysis finds opportunities, authored animation supplies Spider-Man character, and carefully bounded assists preserve flow.
