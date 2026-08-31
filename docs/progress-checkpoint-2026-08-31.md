# GitHub progress checkpoint — 2026-08-31

This is a progress checkpoint, not a claim that all traversal issues are resolved.

## Included

- Updated hero roster and native Pavitr/Iron Man animation routing, with dedicated animation audits.
- Latched Q wall crawling, shared crawl retargeting, finite click zip and grounded rooftop support.
- Ground-start swing push-off, charged releases, momentum preservation, predictive obstacle assistance and repeated-tile collision queries.
- Spider-Woman's chain artwork and body overlay removed. Her name stays above her, with a small `completed / 50 swings` progress bar; the existing unlock requirement is unchanged. The completed bar remains visible after unlocking.
- Downloaded web GLB and the initial instanced strand renderer are saved. **The new renderer is not yet connected to gameplay or visually verified.** Gameplay still uses the existing line renderer at this checkpoint.

## Verification

- Lint, TypeScript and production build passed; the existing large-bundle warning remains.
- All 37 deterministic traversal regressions passed, including floor launch, timed multi-swing momentum, Q toggle, mantle interruption and finite zip.
- Swing-assistance and repeated-world collision tests passed.
- Local showroom checked in the browser. No chain artwork remains.

## Still open

- One actual NYC browser run recorded an interior-clearance failure while its local triangle-clearance check passed. This needs classification and a regression before claiming collision completion. The synthetic tests do not supersede that result.
- Complete integration and short/long visual verification of the textured web model.
- Repeat the full browser traversal trials across representative maps after those fixes.

GitHub publication is requested for this checkpoint. A successful push is not confirmation that a linked hosting deployment has completed or passed its runtime checks.
