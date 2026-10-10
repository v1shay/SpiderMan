# Traversal strategies and implementation coverage

Requested reference: Game Informer's **How Web Swinging Works In Spider-Man** (2018), featuring Ryan Smith and Bryan Intihar: https://www.youtube.com/watch?v=zRfrbISuZQQ

YouTube supplied the title and caption-track metadata but its transcript panel and timed-text endpoint returned no caption content during this work. We cannot certify every statement in the video. The implementation audit also uses Ryan Smith's first-person explanation of the traversal design: https://www.gamedeveloper.com/design/don-t-mean-a-thing-if-you-ain-t-got-that-swing-in-i-spider-man-i-

| Strategy | Implementation |
| --- | --- |
| Building-attached pendulum rather than flying | Existing profiled rope constraint, gravity, real surface anchors, elasticity and adjustable assistance retained. |
| Release timing controls forward speed versus height | Low swing jumps add a bounded forward kick; upswing jumps add height. Velocity remains inherited and capped. |
| Chain swings with little idle time | Jumping off a held web permits another geometry-backed attachment after 280 ms, without requiring a trigger release. |
| Web zip changes direction | In free air, Jump becomes a short one-press zip. Stick/WASD direction overrides camera heading, including U-turns. Candidate collection searches that direction in the actual mesh. No visible building means no zip. |
| Zip to an environmental point, then spring off | Existing point-grapple and timed point launch retained; aim marker uses the same target selector as physics. |
| Precise aiming | Alt or LT/L2 displays a white target ring. Solo free roam slows to a configurable 35%; races and sessions with other players remain real time. |
| Swing into wall run without face-plant | Physical facade contact redirects incoming speed with configurable retention instead of the former 26 m/s entry cap. Deliberate wall steering decays gradually. Capsule sweeps remain authoritative. |
| Wall-to-roof and roof-to-air connection | Clear, supported roof probes enable automatic momentum-preserving roof exits; a timed jump near the rim launches inward over the roof. Ordinary wall jumps still push outward. |
| Parkour without stopping | Validated low-obstacle mantles preserve their incoming horizontal velocity when completed. |
| Sharp web corner turn | Existing mesh-validated corner tether now supports controller stick direction and profiled wall-run entries. |
| Dive for speed | Existing dive and catch retained; controller default is LS/L3. Previously saved controller mappings remain user-owned. |
| Camera communicates momentum | Existing speed FOV, web-dependent camera motion and reduced-motion priority retained. |

Settings now offers 49 bounded numeric controls. New controls cover low-release kick, contextual air zip, web-zip speed, wall momentum retention and aim time scale. Profile import, storage, host race physics and personal-best fingerprints include them.

Verification: `npm run test:video-traversal` exercises contextual zip lifetime, U-turns, missing/blocked anchors, optional double jump, timing-dependent release, held-trigger reattachment, facade speed, supported roof launch, vault continuation, aim and L3 bindings. Existing swing/profile, building avoidance, controller, race-input and destination-race checks remain required. Browser verification exercises actual settings persistence, aim target/slowdown, a complete street trial and real-time racing. Physical controller hardware remains unverified.
