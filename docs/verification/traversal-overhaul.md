# Traversal implementation and verification

The ordinary swing no longer reels as hold pressure rises. Explicit reel input and limited terrain protection remain. Real geometry is the visual endpoint; a corner can offset its simulation pivot by up to 0.8m, blending back toward the surface. Corner attachment, wall contact, and replacement anchors precede an explained failure timeout.

Grounded rope pins now end as a supported landing, retaining held-input eligibility. A blocked upward wall run detects lack of real movement and tries lateral movement in either direction. A wall-to-air continuation retains held swing, without overriding an intentional jump/release.

A single impulse budget prioritizes ground safety, collision avoidance, steering, then comfort/wind. Gravity and passive rope tension remain physical forces. Full loops can start from earned kinetic energy with no loop button, tangent motor, or completion velocity bonus.

## Measurements

- Before: ordinary two-second airborne hold shortened line by 18.01%; after: 0% for pressure 0, 0.5, and 1.
- Passive full loop: 75m/s starting speed, 3.267s, independently measured 6.2889 radians; peak mechanical energy / starting energy = 0.99967.
- Open-air continuous attachment: 15 seconds, no unintended detachments.
- All three shipped city GLBs: 9 routes / 10,080 fixed 120Hz ticks, zero surface penetrations, zero failed aerial continuations, zero immediate detachments. Longest held stall: 32 ticks (267ms), then recovered along the facade.
- The baseline map script used obsolete simultaneous jump/swing and hold-as-reel input, and skipped the retired street-city ID. Updated routes use independent input, current maps, and fail on unknown IDs. Before/after map counts are therefore gameplay-regression evidence, not a controlled performance benchmark.

## Verified commands

- `npm test` (all existing scripts completed after fixes)
- `node --experimental-strip-types scripts/verify-traversal-continuity.mjs` (17 checks)
- `node --experimental-strip-types scripts/verify-integrated-swing.mjs new-york-city procedural-city cyberpunk-city` (all maps)
- `npx tsc --noEmit --pretty false`
- `git diff --check`

Browser street and wall/aerial trial details and the unresolved browser held-input measurement are recorded in traversal-browser-qa.json. These do not substitute for the lead's final race/boss integration and clean browser performance tests.
