# Traversal refinements — September 7, 2026

The supplied Flying FBX and generated Mixamo-compatible slingshot charge/hold FBXs are retargeted onto the original 2099 hierarchy. The original 59 clips remain; the library now has 62 clips. Source hashes and conversion details are in `public/assets/animations/traversal-extras-manifest.json`. The ASCII slingshot exports required indentation and curve-node naming normalization for Three's parser; authored rotation keys and connections were preserved. Controller translation remains authoritative.

Flying provides the body and leg animation. A blended two-bone arm correction spreads the arms for wingspan, rather than leaving the flying source's swept-back arms. Scalloped, ribbed membranes follow the arm, wrist and hip joints and unfold over the transition. Glide streaks and bounded peripheral blur obey the existing output color conversion; reduced-motion disables blur. Slingshot animation time follows charge, and each tether begins at its actual hand position.

## Controls and behavior

- Mouse movement looks/aims; WASD alone supplies walking input. No cursor-position movement fallback or automatic camera steering. Camera pitch now spans -1.12 to 1.22 radians. Aim comes from the rendered camera direction.
- Tap left click within 180 ms to zip; hold longer to swing. A real target uses point zip; empty-space taps use the existing forward air zip. E remains an optional point-launch control.
- Ground velocity brakes exponentially at 12/s and settles to exactly zero. A committed landing roll retains its short momentum window before braking.
- Web Wings: G toggles; W dives, S pulls up, A/D turns. Neutral glide descends gently; dives exchange height for speed and pull-ups spend kinetic energy. Drag prevents repeated pull-ups from creating energy. Authored wind tunnels can supply energy.
- Wall entry is limited to 26 m/s, settles toward 22 m/s, and uses a 16 m/s vertical run for deliberate W/S input. Direction changes ease at 6/s. A short, decaying carry-speed allowance preserves an energetic next swing and is consumed once; landing clears it. These are this game's tuning values.
- Low obstacles up to 1.95 m use Jump Over when the rise and crossing are capsule-clear. Tall walls and blocked overhead paths do not qualify. Every movement remains swept against geometry.
- Slingshot aim exchanges forward travel for launch height, up to 1.12 radians. Charge jump grows through four seconds, capped at 76 m/s initial upward velocity.
- Every explicit double jump chooses a full flip from four variants, including ground-level double jumps. Contact still interrupts animation immediately.

## Research basis and limits

Insomniac describes Web Wings as complementary to swinging: build height and speed before deployment, dip and soar with directional input, and use wind tunnels over low-rise areas and rivers. Sources: [PlayStation official traversal guide](https://www.playstation.com/en-ca/games/marvels-spider-man-2/whats-new-in-marvels-spider-man-2/), [PlayStation hands-on report](https://blog.playstation.com/2023/09/15/marvels-spider-man-2-hands-on-report-gameplay-details-on-symbiote-powers-combat-ps5-features-and-more/), and [PS5 technology discussion](https://blog.playstation.com/2023/09/19/how-marvels-spider-man-2-taps-into-the-power-of-ps5/?sf269051726=1).

Game director Ryan Smith discusses smoothing connections among swinging, zipping and wall-running to build and maintain momentum in [this developer interview](https://www.gamedeveloper.com/design/don-t-mean-a-thing-if-you-ain-t-got-that-swing-in-i-spider-man-i-). These sources establish experience and design intent, not proprietary solver equations, wall speeds or exact PS5 constants. The bounded wall speed, short momentum carry, glide equations, charge timings and mouse controls above are implementation choices for this browser game.

## Verification

`npm test` includes original traversal/mesh/animation checks, imported wall-loop tests, 44 advanced traversal checks and ten focused refinements checks. Those cover stopping without input, monotonic charge height, aimed slingshots, neutral/dive/pull-up glide energy, controllable wall running and one-use carry speed, low-obstacle/ceiling rejection, and independent hand tether origins. The 62-clip asset test samples 1,922 skinned poses.

Initial front/back pose inspection was performed during development. The user requested no further visual checks and will handle final visual acceptance. No claim of exact Insomniac feature parity is made.
