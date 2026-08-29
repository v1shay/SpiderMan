# New York — Spider-Man browser game

A low-latency Three.js traversal game built from the supplied rigged Spider-Man and New York GLB assets.

## Play locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Controls

- `WASD` — move and steer
- Arrow keys — look up, down, left, and right
- Hold `Space` — attach/reel a web from the center reticle; release to let go
- Hold the primary mouse button — attach a web toward the pointer; release to let go
- `Esc` — open or close the Spidey Tracker

The tracker fast-travels to eight real 3D districts. Unloaded districts stream only when approached or selected.

## Analytics

The client records one append-only page view per load when these variables exist:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Apply `supabase/analytics.sql` to the dedicated Supabase project first. The table has RLS enabled, grants only anonymous inserts, and exposes no visitor-reading policy. It stores a random session UUID, path, referrer host, and timestamp—no IP address or user agent.

## Asset pipeline

The source city files are normalized and compressed with Meshopt/WebP. The shipped districts are all below 32 MB, and only the selected suit plus nearby geometry enters browser memory. Suit thumbnails are rendered from the supplied GLBs.

The repository owner is responsible for confirming redistribution and trademark rights for supplied models, textures, names, and fonts before any public release.
