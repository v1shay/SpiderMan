# Swing profiles and destination racing

The default Friendly Neighborhood profile uses a bounded pendulum constraint, tangent pumping, modest rope payout, separately adjustable horizontal/vertical tension and damping, camera pitch control, and momentum-preserving release. Assisted apex handoffs continue a held swing without repeatedly injecting release boosts. Predictive anchor selection rejects blocked arcs; velocity assistance scans the anticipated path, player shoulders, head and feet, while capsule collision remains authoritative. Deliberate dives retain manual control.

Settings exposes 44 numeric controls across momentum, arc/bounce, web/anchors, control, release, assistance and camera. Friendly Neighborhood, Momentum and Acrobat presets are starting points. Named custom profiles persist locally and support JSON export/import. Values and coupled bounds are sanitized. Reduced-motion settings retain priority.

This is an original implementation inspired by publicly described assisted traversal principles, not Insomniac's proprietary implementation:
- https://media.gdcvault.com/gdc2019/presentations/Sheahan_Doug_ConcreteJungleGym.pdf
- https://blog.playstation.com/2023/09/28/marvels-spider-man-2-builds-on-accessibility-in-previous-titles-and-introduces-new-features/

Default races restore the single-destination flow from historical commits 6253b96/aacde79. A seeded, mesh-sampled destination is broadcast before countdown; its tile is retained, beacon and map guidance appear immediately, and swept sphere arrival detects fast crossings. There are no intermediate gates or wind lanes. Host physics is shared and locked during the race, and profile fingerprints keep incompatible personal bests separate. Standings compare every participant's distance to the same finish and then finish times. Legacy checkpoint packets remain compatible.

Verification: bounded profile round trips and presets; pendulum descent/rise and look-up/down response; assistance versus a real triangle obstacle (0 versus 11 contact frames); three-client simulated race protocol and consistent ranking; all three city meshes and three seeds; 26 legacy race regression checks; controller regressions; TypeScript and production build. Chrome browser checks cover settings persistence and gameplay. Physical Bluetooth controller hardware and a live multi-person Internet session were not available for this verification.
