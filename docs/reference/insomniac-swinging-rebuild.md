# Insomniac traversal research and the browser implementation

Reviewed October 14, 2026. The target is the connected feel of Insomniac's 2018 Spider-Man and 2023 Spider-Man 2. Public talks disclose design techniques, not enough code, tuning, animation assets, or measurements to establish a literal one-to-one reproduction. Constants in this repository are our own.

## Primary source trail

1. Doug Sheahan, **Concrete Jungle Gym: Building Traversal in Marvel's Spider-Man**, GDC 2019: [session](https://www.gdcvault.com/play/1026422/Concrete-Jungle-Gym-Building-Traversal), [complete slides and speaker notes](https://media.gdcvault.com/gdc2019/presentations/Sheahan_Doug_ConcreteJungleGym.pdf). Downloaded and extracted the original 264-page PDF directly. PDF page numbers below include the speaker-note continuation pages; they differ from slide numbers.
2. Doug Sheahan, **Higher, Faster, Farther: Evolving Traversal in Marvel's Spider-Man 2**, GDC 2024: [session](https://www.gdcvault.com/play/1034327/Higher-Faster-Farther-Evolving-Traversal), [slides](https://media.gdcvault.com/gdc2024/Slides/GDC%2Bslide%2Bpresentations/Sheahan_Doug_Hig.pdf). The session description and indexed slides were accessible; direct PDF retrieval returned 403. Do not represent this as a complete review of that recording/deck.
3. Robert Coddington, **The Animation of Marvel's Spider-Man**, GDC 2019: [session](https://www.gdcvault.com/play/1025971/The-Animation-of-Marvel-s). Confirms the animation director's traversal/combat presentation; session metadata alone does not substantiate individual implementation details.
4. Insomniac animation directors, **Thwips and Hugs: The Animation of Marvel's Spider-Man 2**, GDC 2024: [session](https://gdcvault.com/play/1034543/Animation-Summit-Thwips-and-Hugs). Useful animation research lead, not evidence that we reviewed the entire recording.
5. PlayStation, **Your guide to what's new in Marvel's Spider-Man 2**: [official guide](https://www.playstation.com/en-us/games/marvels-spider-man-2/whats-new-in-marvels-spider-man-2/).
6. PlayStation, **How Marvel's Spider-Man 2 taps into the power of PS5**, September 19, 2023: [official article](https://blog.playstation.com/2023/09/19/how-marvels-spider-man-2-taps-into-the-power-of-ps5/).

Searches also surfaced player discussions and third-party summaries. They were discovery leads only; physics decisions are grounded in the original 2019 notes and explicit public sequel material.

## What the sources establish

**2019 notes:** PDF pp. 67–88 describe a physics foundation, 120 Hz integration, taut-line management, gradual catch redirection, stronger trough steering, and entry-speed-dependent travel. PDF pp. 102–128 explain invisible assistance: offset the simulation pivot while keeping the visible attachment, scan for clear lanes, damp problematic steering, and protect ground clearance. PDF pp. 130–138 distinguish releasing from jumping and explain replacing prescribed jump metrics with freer momentum-preserving exits. PDF pp. 167–194 discuss camera framing and speed cues. These are design mechanisms, not published constants for this game.

**2024 material:** The session addresses updating traversal for higher speeds. Indexed slide 44 describes forward/side wall tests, opening nudges, and steering damping. Indexed slide 54 describes a skill-built, decaying momentum allowance governing swing and timely point-launch boosts without slowing the player. Those slide findings do not establish that every web-wing assist was also applied identically to web swinging.

**Official gameplay descriptions:** Swinging and Web Wings complement each other; players build height/speed before gliding. Slingshots and wind tunnels extend traversal. The PS5 article describes faster swinging and smooth interchange between swinging and gliding. Neither publishes numerical physics or wall-input rules.

## Diagnosis in this repository

The previous policies conflicted in several concrete ways:

- Normal attached motion paid out most outward horizontal travel every tick. Together with vertical-only constraint correction, this weakened the rise after a swing's trough.
- The release helper imposed an upward floor based on hold duration, up to 35 m/s before bonuses. Two releases from the same incoming trajectory could have unrelated exit angles.
- Character style overrides reduced steering acceleration to 10–27 even though the shared profile specified 72. A character selection could silently make turning much harder.
- Wall entry reduced fast arrivals to 26 m/s, sustained running used fixed targets, and a stored velocity refund could reappear on the next catch.
- Automatic full loops could take over ordinary high-energy holds.

## Implemented policy and design choices

The production advanced configuration enables `flowTraversal`. The legacy policy remains available for its existing numerical contracts; production behavior is verified separately.

### Catch and arc

`flowSwingPivot` removes the lateral pull toward a side building by placing the simulation pivot in the incoming travel plane. A small forward lead gives side attachments a downswing before the trough. The visual endpoint stays on the real surface. This is an implementation inspired by the disclosed pivot-assistance concept; it is not Insomniac's exact pivot algorithm.

The flow solver blends incoming velocity toward the tangent while retaining kinetic speed. Loaded lines use tangential gravity. Inward motion takes up slack; forward travel no longer continuously lengthens the web. The swept capsule resolves constraint corrections. At the late upswing, holding the trigger permits an unboosted handoff before a passive pendulum reversal. A new catch still needs a real, visible candidate; an old anchor behind the intended heading cannot repeatedly recapture the player.

### Speed and steering

Ordinary catch allowance starts around 38 m/s. Fast entry and dive energy can establish a larger allowance, up to 78 m/s. A motor helps below that allowance and a gradual taper handles excess ordinary swing speed; the existing overall cap still bounds launches and dives. This taper is our comfort choice, not a claimed copy of the sequel's momentum meter.

The steering floor is shared across suits, increases through the trough, and blends in after attachment. Steering rotates existing velocity rather than adding sideways speed indefinitely. Collision correction receives priority in the shared impulse budget; steering and propulsion use the remaining allowance. Free-air directional input also rotates velocity, avoiding unbounded repeated forward acceleration.

### Releases, jumps and acrobatics

Normal release preserves vertical velocity and gives only a small forward assist below high cruising speed. A sub-60 ms tap gains no release energy. Space explicitly performs a swing jump, adding bounded lift and forward impulse without also consuming an air jump. Releasing during descent stays a descent; an upswing exit retains its earned height.

Safe rising releases strongly prefer aerial variation. Backflips, front flips, twisting flips and other available clips retain deterministic variety, clearance checks and enough predicted airtime to finish. Animation owns presentation; it never translates the collision body. Trick cadence is shorter without removing those gates.

### Wall traversal

Wall arrival redirects usable speed into a bounded facade run, instead of an immediate 26 m/s reset. Sustained running settles smoothly toward 27 m/s. W/S request up/down; A/D use camera-right projected onto the actual facade, including opposite wall orientations. Diagonal input is normalized. Reversals blend rather than instantly snapping direction. Genuine foot support is still required, and jumps detach using the existing collision path. No hidden speed refund is stored for a later catch.

### Existing connected abilities

Point grapples, buffered point launches, corner tethers, explicit dive-earned loops, slingshots, gliding and camera collision remain on the shared motor. Their existing tests exercise cancellation, geometry support and speed bounds. Ordinary swinging no longer starts a full loop automatically; explicit loop input still requires sufficient earned energy.

## Reproducible verification

- `node --experimental-strip-types scripts/verify-traversal-flow.mjs`: production profile, weak style overrides, side-anchor arcs/handoffs, release versus swing jump, wall controls on both orientations, animation variation/clearance, and frame-rate equivalence.
- `node --experimental-strip-types scripts/verify-camera-swing.mjs`: composed rope forces, steering budget and swept triangle collision against 6 m, 32 m and 100 m facades.
- `node --experimental-strip-types scripts/verify-integrated-swing.mjs`: routes in all three actual city GLBs, including repeated-world offsets, authoritative collision, real anchors, wall contact and held-input continuity.
- `scripts/verify-advanced-traversal.mjs` and `scripts/verify-traversal-refinements.mjs`: connected abilities, releases, walls, geometry and bounds. Assertions that required the old charged-release floor and wall-speed refund now express the new behavior.

Automated geometry checks establish collision and control properties. They cannot establish a perceptual one-to-one match to a commercial game. Browser input tests and screenshots are recorded separately in the verification report.
