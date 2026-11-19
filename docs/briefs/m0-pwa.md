# M0: PWA shell and deploy

Model: sonnet. Read `docs/briefs/README.md` for the common rules.

## Goal

The built game installs to a phone's home screen, runs offline, updates itself, and is deployed to
GitHub Pages on every push to the working branch. After this task `npm run build`, `npm run dev` and
the whole `npm run gate` work.

## You own

- `scripts/make-icons.mjs`, `scripts/make-sw.mjs` (and `.d.mts` beside each if the typecheck needs it)
- `public/manifest.webmanifest`
- `src/app/pwa.ts`, `tests/unit/pwa.test.ts`
- `tests/e2e/pwa.mjs`
- `.github/workflows/pages.yml`
- In `index.html`: only the `<head>` links and meta tags for the manifest and icons.
- In `src/app/main.ts`: only the one call to `registerPwa()`.

## What to build

`package.json` already defines the scripts; match them, do not change them:
`dev` = icons then vite; `build:app` = icons, `vite build`, service worker; `e2e:pwa`.

- **Icons**, generated in code with no dependencies (write the PNG encoder with `node:zlib`):
  `public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (180).
  Design: the palette's dark background (`#1b1630`) with a bold yellow (`#ffd23f`) chevron or
  speed-streak mark that reads at 48 px; the maskable icon keeps the mark inside the safe zone. The
  PNGs are generated at build time and git-ignored (add `public/*.png` to `.gitignore`).
- **Manifest**: name SHMOOVE, `display: standalone`, `orientation: portrait`, theme and background
  `#1b1630`, relative `start_url` and `scope` (the site is served from a sub-path on Pages).
- **Service worker**, generated after the build by `make-sw.mjs` into `dist/sw.js`: precache every
  file in `dist/` under a cache named by a hash of their contents, cache-first for those, network
  for everything else; on activate delete old caches; `skipWaiting` only when the page asks.
- **`src/app/pwa.ts`**: `registerPwa()` registers `./sw.js` in production builds only (vite defines
  `__SHMOOVE_BUILD__`; see `vite.config.ts` and `src/vite-env.d.ts`). When a new version is waiting,
  show a small "New version: tap to update" bar at the bottom edge (DOM, palette colours, inside the
  safe area) that activates it and reloads. Keep the decision logic pure and unit-tested.
- **`tests/e2e/pwa.mjs`**: against `vite preview` of `dist/`: the manifest and all four icons load;
  the service worker takes control; the page reloads and boots with the network offline (`?hook`
  reports ready); after rebuilding the worker with changed content, the update bar appears and
  tapping it loads the new version. No console errors or warnings.
- **`.github/workflows/pages.yml`**: on push to `claude/festive-babbage-zk6cxn` and `main`, and on
  manual dispatch: Node 22, `npm ci`, `npm run build`, upload `dist/`, deploy to Pages. A second,
  non-blocking job runs typecheck, lint and test.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` pass.
2. `npm run build` passes and `dist/` contains the icons, the manifest and `sw.js`.
3. `npm run e2e` (existing routes) and `npm run e2e:pwa` pass.
4. Open `public/icon-512.png` with the Read tool and say what you see.
