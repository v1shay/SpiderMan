# Traversal and animation pass — 2026-08-30

## Primary-source research

- [Insomniac: the technology behind Marvel's Spider-Man](https://blog.playstation.com/2018/09/06/insomniac-interview-the-tech-behind-marvels-spider-man/): real geometry attachments, momentum and assistance, animation and camera working together.
- [Doug Sheahan, Concrete Jungle Gym — GDC developer slides](https://media.gdcvault.com/gdc2019/presentations/Sheahan_Doug_ConcreteJungleGym.pdf): ground-height queries for swing assistance; pitfalls of early anchor ray arrays near corners and non-collidable scenery; arc-specific traversal animation and transition selection.
- [PlayStation's hands-on traversal account](https://blog.playstation.com/2018/06/15/playing-marvels-spider-man-made-me-feel-like-spider-man/): swing, straight-line zip and perch are separate, chained traversal actions.

These are design principles, not the proprietary game's physics constants or a claim of equivalent production polish.

## Changes informed by the research

- A shared typed-array BVH indexes visible static and instanced map triangles. Each streamed tile translates queries into that template; it does not duplicate the collision BVH.
- Capsule sweeps cover the entire movement, including rope shortening and web zips. Wall, ceiling and ground contacts have distinct normals. Rendered geometry, not broad building boxes, is authoritative.
- Rooftop spawn selection samples real upward-facing roof triangles, verifies a supported footprint, rejects obstructed/interior starts, and prefers broad clear roofs. Spawn camera direction is selected for both chase-camera clearance and an open view.
- Swing forces preserve velocity, gravity and rope length; timed release retains momentum. Quick attachment/release cannot repeatedly generate free launch impulses. Obstructed ropes release without a boost.
- Low-swing assistance queries actual ground 0.3 seconds ahead. It only reduces descent, with a per-attachment impulse budget and acceleration cap; no assistance over unsupported voids or during a deliberate dive.
- Q remains required for wall crawling, together with measured feet-level wall contact. Swinging into a building does not automatically switch to walking/crawling.
- Source swing clips are scrubbed by arc phase. The attached upswing does not replay the source's released backflip. Run fades into jump/fall on release; web aiming uses the rig's hand.
- One animator drives gameplay, lobby and remote-avatar presentation. Actions are keyed by clip identity, preventing a borrowed `stand` from overwriting an authored clip with the same name.
- PlayStation and Pavitr use sampled upright reference poses before retargeting and normalization. Sole probes follow skinned shoe vertices instead of bind-pose bounds. Selected lobby heroes use safe supplied emotes, with procedural fallback only where needed.

## Repeatable verification

```sh
npm run test:avatars
npm run test:avatar-motion
npm run test:traversal
npm run test:surfaces
npm run lint
npx tsc --noEmit
npm run build
```

The surface tests decode all five source GLBs, verify supported and capsule-clear roof starts, and test an 88 m/s roof descent. Synthetic cases include thin walls from both directions, diagonal corners, ceilings, raised sidewalks, rope correction, roof edges, instancing and invalid interior starts.

Animation tests load all ten actual source rigs, sample complete shoe-weighted vertex sets independently of runtime probes, and check source clip identity, upright standing scale, grounded drift, perch frames, arc playback, airborne transitions, emotes and finite hand transforms. CPU tests intentionally skip texture image decoding; texture appearance and camera framing require browser inspection.

## Observed verification results

- Lint, TypeScript and production build pass. The build retains a large-chunk warning; this is not a runtime failure or a guarantee of fast downloads.
- All ten rig audits and 21 deterministic traversal regressions pass, together with the synthetic mesh suite and all five actual-map rooftop/drop checks.
- Local browser inspection covered the ten-hero lobby, PlayStation upright pose, corrected Pavitr scale, and rooftop starts in New York City, New York Buildings, Street City and City Night. Tobey's authored crouch was visible after the camera target was lowered to his real head.
- A real Street City facade click initiated a zip; keyboard jump was registered; the zip line cleared afterward without forced wall crawling. These checks do not replace prolonged player testing of every possible trajectory.
- Backstreet's final visual check was not completed: browser approval tooling disconnected. Its actual GLB collision/rooftop checks passed. The last refinement prioritizing a clear chase-camera direction was applied after the NYC close-up inspection; no final wide NYC screenshot was taken.
- Some supplied rigs lack compatible authored traversal/emote clips. Their procedural fallback is explicitly reported by the animation audit, not represented as a supplied animation.

## Boundaries

- This pass is local; it does not publish a deployment or modify backend configuration.
- Imported assets are not rebuilt. Alpha-masked decoration uses triangle collision rather than per-pixel alpha. Some source meshes are thin/open; continuous sweeps from a verified spawn are the principal protection.
- Procedural fallback perches are not full four-limb IK. Retargeted hands can differ slightly from the source pose because limb proportions differ, even when shoe contact is correct.
- Browser frame rate depends on hardware and map rendering. Geometry benchmarks are not FPS guarantees.

## Follow-up: latched wall crawl and finite click zip

- Q is now an edge-triggered toggle. It requires a short, feet-height hit against rendered facade geometry; incidental swing contact cannot latch it. Jump, swing, zip or lost foot contact clear it.
- W/S command vertical movement and A/D command facade-tangent movement independently. Previously, rejecting forward input against a wall also generated an unwanted sideways fallback.
- A pose-only wrapper aligns each rig's anatomical head/feet axis upright and its back away from the facade. Body clearance is followed by two-bone leg IK to plant the shoes without pushing the torso into the wall. Joint corrections are restored before the next authored animation update.
- A supported roof rim starts a swept rise-then-cross mantle. Missing/obstructed roofs are rejected; jumping or swinging can interrupt the transition.
- Click zip uses a facade-clear endpoint, terminal arrival/overshoot/stall conditions and a bounded lifetime. Old held swing input must be released before it can attach again after a zip; no endpoint orbit or automatic conversion into swing.
- The crawl camera stays outside the wall, including low parapets, and keeps world-up. The previous low-wall camera exclusion could put the camera inside the avatar.

Verification: `npm run test:wall` adds four actual-triangle facade-to-roof climbs, invalid-contact/roof guards, and 360 full-skinned-geometry poses across all nine Spider-Man suits. Sampled poses remained upright, with full-mesh clearance of about 2 cm and nearest sole gaps of 2–4.1 cm. These geometric measurements do not certify every hand/foot contact on arbitrary decorative geometry. `test:traversal` now has 30 deterministic regressions, including tap-Q persistence, second-Q detach, jump/swing/zip exits, mantle interruption, and one-shot zip completion with stale held swing input.

The local browser check used Symbiote in New York City: click zip to a visible rooftop facade, tap Q and release, observe the upright planted pose and stable exterior camera, then jump and confirm the crawl latch and web cleared. It also exposed the low-parapet camera regression, which was fixed and rechecked. All ten avatar-motion audits, all five source-map support/drop audits, lint, TypeScript and the production build passed after the fix. This follow-up has not been deployed.

## Pavitr: original animations only

Pavitr no longer declares a shared `animationSource`; all three loaders (lobby, local player, remote player) therefore skip the borrowed library for him. His animator also rejects foreign clip names if another caller accidentally appends shared animations. All 23 clips embedded in his original GLB remain available and their joint quaternion keyframes are preserved. Shell_Idle, both original fidgets/victory clips and the sampled original Special_Attack perch are used, without imported hip-hop/silly emotes or generic Spider-Man swing clips.

The supplied `Run_ABOVEGROUND` contains one keyframe at time zero, not a moving loop. It is retained as source data but no longer makes the character slide along in a frozen run frame. Missing usable run/jump/swing/crawl actions use local procedural animation and the existing contact corrections; they are not claimed to be native traversal clips. Attack/ultimate clips are preserved, not mislabeled as dedicated crawl or swing cycles. Normalization, root-motion removal and foot-contact corrections remain necessary for collision-safe gameplay.

`npm run test:avatar-motion -- --suit=pavitr` now additionally checks all native clips survive, original joint values are unchanged, a deliberately injected foreign clip is rejected, and the missing-run procedural gait actually moves. This is a local source change; Vercel is unchanged.

## Crawl animation coverage across the roster

The shared traversal library contained no crawl cycle, and the general retargeter only handled Mixamo skeletons. A dedicated wall-crawl retargeter now maps anatomical roles, canonical-space rotations and limb directions across the different exporter rest poses. The compact reference in `lib/wall-crawl-motion.json` is sampled from the supplied PlayStation `Crawl` animation by `scripts/bake-wall-crawl.mjs`; no extra source GLB is downloaded at runtime. Retargeting is baked once per avatar load, not per render frame.

- Tobey, Spider-Man, Miles, Miguel, Iron Spider and Spider-Woman: mapped PlayStation crawl cycle.
- PlayStation and Symbiote: their own existing crawl clips remain in use.
- Pavitr: a keyed cycle generated on his calibrated rig, preserving the no-borrowed-animation policy and all 23 original clips.
- Iron Man: separate repulsor controls remain unchanged; no Spider-Man wall power is added.

Every Spider-Man now uses a real looping AnimationAction for wall crawling. Playback follows movement speed, stops while stationary and reverses on descent. Local and remote avatar rendering both apply the surface alignment/contact pass, with no network protocol or backend changes. Existing lobby/perch selection is performed before registering the new crawl so unrelated poses are not replaced.

The expanded `test:wall` checks 540 full-skinned-mesh poses across all nine Spider-Man rigs and four facade directions, including a complete crawl cycle, movement of each hand and foot, zero-speed pause, reverse playback and fade-out after jump. It distinguishes allowed forward body lean from sideways rotation on the wall. The five-map mesh physics remains shared; retargeting does not change collision geometry, Q toggling, or swing forces.

Verification passed: all 540 wall poses, all ten actual-GLB motion audits, 30 traversal regressions, avatar checks, TypeScript, lint and production build. A local browser check used Miguel against a rendered rooftop facade: tap-Q persisted, `retargeted-wall-crawl` was active, the upright exterior pose measured a 2 cm nearest-foot gap and 2.7 cm body clearance, and Space cleared the crawl latch and switched to jump. No browser errors were recorded. These checks cover the tested poses and facade contacts, not every possible decorative surface. This update remains local; production has not been redeployed.

## Pavitr follow-up: actually route the original animation pack

Preserving all 23 clips was not enough: generic `jump`/`swing` name matching never selected Pavitr's differently named acrobatic sequences. The downloaded original and optimized GLB both contain the same 23 actions. The earlier fallback-only policy for his traversal has been replaced with an explicit native animation graph after visually inspecting all source sequences in a local contact-sheet viewer.

| Gameplay moment | Native source |
| --- | --- |
| Showroom selection and initial stationary spawn | Full `Entry`, once, then native idle/perch |
| Ground jump | `Special_Intro` leap/tuck |
| Release from swing or zip | Alternating aerial sections of `Entry` and `Basic_SideHandSpring_RM` |
| Attached swing | `Special_A` web-reaching/tucked motion, ping-pong playback |
| Click zip | `Ultimate_FLYOFFSCREEN` reach/launch section |
| Freefall | Airborne section of `DropIn` |
| Dive | Inverted section of `Special_D` |
| Landing | Landing/recovery section of `DropIn`, once |
| Selected lobby | Original Shell_Idle, Shell_Fidget, Fidget_Victory_IN and Passive |

`lib/pavitr-animation.ts` extracts sections directly on Pavitr's own skeleton. It retains native timing, interpolation and joint values; no other character's clip is retargeted onto him. Original source clips remain available alongside these named runtime sections. Root-motion translation remains controller-owned to prevent animation from bypassing collision. Combat-only sequences are not mislabeled as traversal. The exported Run_ABOVEGROUND is still one frame and therefore needs the local running gait; the local crawl cycle remains unchanged.

Entry/landing are interruptible. Crossing the apex does not restart the release flip, and a completed flip transitions to freefall instead of replaying takeoff. Native entry replays when Pavitr becomes the selected lobby hero. Inverted entry uses bounded whole-body support probes through its crossfade; the crouched perch also corrects fingertip clearance without lifting the soles. Original animation data is not rewritten by these per-frame contact corrections.

`npm run test:pavitr` checks all routes, finite releases, both aerial variants, pause/interruption behavior, native lobby selection, 108 full-mesh grounded samples and 27,146 comparisons of extracted values against their source curves. Quaternion comparisons account for equivalent q/-q signs. The existing native-pack audit continues to check that all 23 original actions survive and foreign clips are rejected. The local browser contact-sheet tool at `/scripts/pavitr-preview.html` displays source and actual runtime poses; it is a development file, not included in the deployed public assets. Browser checks also confirmed actual city Space input selected `pavitr-native:leap`.

Final verification: all ten avatar audits (166,348 checks), all 540 wall poses, 30 traversal regressions, lint, TypeScript and production build passed. Browser selection reported the original `Armature|Anim_SpiderManPavitr_Entry` and visibly showed the handstand entry; the game and inspector recorded no browser errors. The existing large-bundle build warning remains. This update is local only. The production Vercel site has not been changed.
