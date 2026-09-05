# 2099 corrective overhaul

Scope: correct the supplied rig before judging animation quality; implement the user's revised controls and assisted swing design; match reference lighting without blur color shifts; implement consensual lobby races, shared destinations, local PB ghosts, live MapLibre players, and wind tunnels. The delivered artifact is the game and its verification evidence.

1. **In progress:** diagnose and correct retargeting from the source FBX skeletal motion; verify actual limb direction and visual poses, then wall locomotion alignment.
2. Discover and reconcile primary developer evidence for traversal/camera, plus official browser/Three/Supabase interfaces. Record claims versus custom design choices.
3. Implement revised controls, gradual pivot capture, charged release, wall transitions, jump clips, sky/blur, and font.
4. Implement race lifecycle, invitations/acceptance/countdown/shared course, timing/PB/ghosts, map positions, wind corridors.
5. Verify source-motion fidelity, collisions, pressure/hold behavior, camera/sky color, race synchronization and persistence, and complete recorded gameplay. Publish only the corrected result.

Assumptions: mouse/trackpad hold duration works everywhere; actual variable pointer pressure augments it when available. Race requests invite online players but never teleport someone who did not accept. PB ghosts persist locally per course. No claim of proprietary PS5 constants or AAA visual equivalence.

Primary source classes: Insomniac GDC slides, PlayStation developer interviews/hands-on, original reference repository, Three.js source/documentation, W3C Pointer Events, Supabase Realtime docs.

Planning tool discovery found no callable update_plan tool; this document records the required plan instead.
