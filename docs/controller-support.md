# Controller support

Pair a compatible Xbox, DualSense, DualShock, or other controller in macOS System Settings → Bluetooth. Open the game in a browser that exposes the Gamepad API, focus the game tab, and press a controller button to make it discoverable. USB controllers use the same input path. No pointer lock is needed for controller gameplay.

The standard default layout takes its core controls from Insomniac's games and adapts this game's additional abilities:

| Action | Xbox | PlayStation |
| --- | --- | --- |
| Move / look | Left / right stick | Left / right stick |
| Swing | RT | R2 |
| Jump | A | Cross |
| Point zip | LT + RT | L2 + R2 |
| Point launch | LT + A | L2 + Cross |
| Charge jump (grounded) | RT + A | R2 + Cross |
| Dodge / roll | B | Circle |
| Dive | Right stick click | R3 |
| Web wings | Y | Triangle |
| Air trick | X | Square |
| Wall crawl | LT + Y | L2 + Triangle |
| Slingshot | LB + LT | L1 + L2 |
| Corner tether | RT + B | R2 + Circle |
| Loop | LB + RT | L1 + R2 |
| Reel in / out | D-pad up / down | D-pad up / down |
| Attack (boss fight) | X | Square |
| Heavy / launcher | LB + X / LB + A | L1 + Square / L1 + Cross |
| Grab / block / web | Y / LB / RB | Triangle / L1 / R1 |
| Interact / taunt | D-pad left / right | D-pad left / right |
| Pause / resume | Menu | Options |

Settings → Gameplay → Controller shows connection status and lets you remap each action, including combinations. Select an action, release all buttons, then press and release the desired button(s). Longer combinations consume their component buttons to avoid accidental jump/swing/attack actions. Menu/Options remains reserved for pause. Bindings, dead zone, sensitivity, inversion and axis selection persist in this browser. Nonstandard controllers can require button and axis remapping; controllers not exposed by the browser cannot be read by the game. On-screen move and combat prompts reflect saved controller bindings.

Disconnects release held actions; background tabs stop accepting controller input. Race countdown suppresses actions and accepts a held button on GO. Keyboard and mouse remain usable alongside the controller.

Verification: `node --experimental-strip-types scripts/verify-controller.mjs`, `npm run test:race-input`, TypeScript and production build. Physical Bluetooth hardware compatibility must be verified on the player's Mac.

Sources: [Apple pairing instructions](https://support.apple.com/en-ie/111099), [MDN Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API), [official PlayStation combat overview](https://blog.playstation.com/2023/09/15/marvels-spider-man-2-hands-on-report-gameplay-details-on-symbiote-powers-combat-ps5-features-and-more/).
