# Traversal flow verification

Verified October 14, 2026 against the integrated GitHub main branch and this rebuild.

- Production build: passed.
- TypeScript: passed.
- Lint for changed source and verification scripts: passed.
- Production flow regressions: 10 checks, including frame-rate equivalence, side anchors, depleted catches, camera-relative wall controls, release/jump distinction and safe animation variety.
- Composed avoidance: zero contacts against 6 m, 32 m and 100 m synthetic triangle facades.
- All three real GLB maps: nine routes, zero capsule penetration. Maximum consecutive stall was 16 frames at 120 Hz (0.133 seconds), in Cyberpunk; New York and Procedural had zero. Replay includes the production safe-vault probe.
- Advanced traversal, refinements, profile controls, directional zips and controller regressions: passed.
- Browser street trial on the merged Friendly Neighborhood profile: 16 seconds, 359 m, peak 56.3 m/s, 100% airborne, 20 real attachments, one contact frame, 76 penetration checks, zero penetrations.
- Browser wall/aerial sequence: 7.02 seconds, 320 frames, zero penetrations; wall run, wall crawl, wall jump, aerial flip, roll and run transitions observed.
- Browser JavaScript errors: none.

The browser uses real visible development trial controls and the normal input, triangle collision, animation and rendering paths. The screenshot is after the wall sequence, at rest. These measurements establish functioning traversal and collision continuity; exact perceptual parity with the commercial games remains unverified.

All scripts in the `npm test` sequence passed. The full run reached the character stage; after correcting its stale clip-count assertion and repairing the six Classic clips, that stage and the remaining web-strand, analytics and race-input stages were rerun successfully.

The rig check covers all 12 selectable suits and all 73 clips per suit. Six pre-existing Classic clips had inverted upper-leg directions, including Butterfly Twirl. They were regenerated from the calibrated 2099 reference with the anatomical world-space retargeter. Classic's worst measured limb-direction agreement improved from -0.996 to 0.999999; every rig passes the existing fidelity and skin-bound thresholds. `scripts/repair-classic-traversal-clips.mjs` reproduces the repair without altering the other 67 Classic clips.

Previously saved Friendly Neighborhood/Acrobat defaults migrate to the new takeoff; explicit Custom tuning is preserved. Profile fingerprints distinguish the new engine so old ghost records cannot silently mix physics.
