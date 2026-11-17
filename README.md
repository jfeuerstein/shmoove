# SKITCH

SKITCH is a portrait, one-thumb skating game set in Santa Rampa, a hilly seaside city where you never
push: you roll downhill, grab the back of buses, trams and funiculars, and slingshot off them to chain
ride into ride. Every line you ride end to end is inked onto the transit map, and inking the whole map
makes the city yours. It runs in the browser and installs as an offline app on a phone; every shape,
colour and sound is generated in code.

## Run it

Needs Node 22.12 or newer.

```sh
npm install
npm run dev
```

Open the URL Vite prints (it listens on your network too, so a phone on the same Wi-Fi can open it).
`npm run dev` first draws the app icons into `public/` (they are generated, not checked in).

### URL parameters

Add them to the address, for example `http://localhost:5173/?slice&debug`.

| Parameter | What it does |
| --- | --- |
| `debug` | Opens the feel panel: every movement and camera constant, live, with COPY to export changes |
| `slice` | Boots the M1 feel slice (one hill, one tram, one funicular) |
| `world=NAME` | Boots a named world: `slice`, `lineup`, `proptown`, `city` |
| `t=0.5` | Starts at that time of day, as a fraction of the day (0 midnight, 0.5 noon) |
| `seed=N` | World and random seed (integer, default 1) |
| `mute` | Starts with audio muted |
| `route=NAME` | Plays a built-in input script instead of your thumb (`perf`: an endless busy ride). No title screen |
| `chalk=SK2-...` | Opens the chalk import box with that share code pasted |

Controls: touch and drag to carve; touch and hold to arm a grab, which hitches the nearest ride in
reach; lift to let go (the slingshot); flick up to hop. On a keyboard: arrows or A/D steer, Space holds,
W or Up hops, M opens the map, P pauses.

## Build and preview

```sh
npm run build     # typecheck, icons, vite build, service worker -> dist/
npm run preview   # serve dist/ at http://127.0.0.1:4173/
```

The service worker only registers in the built app, so offline play and updates are tried with
`preview`, not `dev`.

## Test

| Command | What it proves |
| --- | --- |
| `npm run typecheck` | The TypeScript compiles under strict settings |
| `npm run lint` | ESLint passes, including the rules that keep `src/sim/` pure and deterministic |
| `npm test` | Unit tests and deterministic sim tests pass headless (movement, hitching, rides, saves, UI logic, icons, service worker, haptics, settings) |
| `npm run e2e` | Every scripted route in `tests/e2e/routes/` plays in headless Chromium at 390x844 with real touch input, its expectations hold, and its screenshots land in `artifacts/screens/` |
| `npm run e2e:pwa` | The built app is installable and offline: manifest and icons served correctly, the service worker activates, a reload with the network gone still boots, and a new build reaches the player through the "new version" ticket |
| `npm run perf` | The scripted route stays inside the budgets (frame time at 4x CPU throttle, draw calls, triangles, JS gzip size) |
| `npm run gate` | All of the above in order; a milestone is done only when this is green |

The e2e and perf runners build `dist/` if it is missing; run `npm run build` first after changing code.

E2E-only URL switches (used by the routes, not meant for players): `e2e` (manual stepping: time moves
only when the harness advances it), `save` (use storage under `e2e`), `title` (show the title screen
under `e2e`), `sw` (register the service worker under `e2e`), `celebrate` (open the map-complete screen).

## Deploy

`dist/` is a static site with relative URLs (Vite `base: './'`), so it works at a domain root or under
any sub-path without rebuilding. Serve it over HTTPS (service workers need it; `localhost` is exempt).
After each deploy check that `sw.js` is served (not a 404): a missing `sw.js` leaves everyone who has played before on the old build.

### GitHub Pages

1. In the repository, Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. The workflow is in the repo: `.github/workflows/pages.yml` builds the game and deploys `dist/` on
   every push to `develop` (and on demand from the Actions tab). Its `checks` job runs typecheck, lint
   and the tests alongside without holding the deploy back. To deploy from another branch, change
   `branches: [develop]`; if the `github-pages` environment restricts which branches may deploy
   (Settings → Environments → github-pages → Deployment branches), allow that branch there.

3. Push to `develop`. The game appears at `https://<user>.github.io/<repo>/`. The relative base is what
   lets it live under `/<repo>/`; nothing needs configuring for the sub-path. GitHub Pages caches files
   for 10 minutes, so a new version can take that long to be offered.

### Netlify or Cloudflare Pages

Run `npm run build` and drag the `dist/` folder onto Netlify's deploy page (Sites → Add new site →
Deploy manually) or Cloudflare Pages (Create → Pages → Upload assets). Both read `dist/_headers`,
which the build copies from `public/_headers` and which sets the cache headers below.

### Any static host

Upload the contents of `dist/`. The headers that matter:

- `sw.js`: `Cache-Control: no-cache` (or a short max-age). If it is cached for long, players do not
  see new versions until it expires.
- `index.html` and `manifest.webmanifest`: `no-cache` too; the manifest as
  `Content-Type: application/manifest+json`.
- `assets/*`: file names carry a content hash, so `Cache-Control: public, max-age=31536000, immutable`.

## Install it on a phone

- **Android, Chrome:** open the site, tap INSTALL on the title screen (or in Settings), or use the
  menu → Install app / Add to Home screen. It opens fullscreen in portrait and works offline after the
  first load.
- **iPhone or iPad, Safari:** open the site, tap Share → Add to Home Screen. (Safari has no install
  prompt; the title screen shows that hint instead.)

When a new version is deployed, the game downloads it in the background and shows a "new timetable"
ticket; RELOAD switches to it.

## Wrap it as a native app later (not done here)

Capacitor can wrap `dist/` as is, because nothing assumes a browser chrome and every URL is relative:

```sh
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init SKITCH com.example.skitch --web-dir dist
npx cap add android
```

Then `npm run build && npx cap sync` after each change. Use `@capacitor/ios` and `npx cap add ios`
for iOS.

## Project layout

| Path | What lives there |
| --- | --- |
| `src/sim/` | The deterministic simulation: pure TypeScript, fixed 60 Hz step, seeded RNG, no DOM |
| `src/input/` | Touch gestures turned into one input frame per tick |
| `src/render/` | Three.js: reads sim state, never writes it |
| `src/audio/` | Web Audio synthesis and the stem mixer |
| `src/ui/` | DOM overlay: destination boards, ticket stubs, line map, chalk, title, pause, settings |
| `src/app/` | Boot, main loop, saves, settings, haptics, PWA glue, debug panel |
| `scripts/` | The gate, the icon generator and the service worker generator |
| `public/` | The manifest and host headers (icons are generated here at build time) |
| `tests/` | `unit`, `sim`, `e2e` (routes and the PWA check), `perf` |

## Tuning the feel

Open the game with `?debug` (try `?slice&debug`): the feel panel lists every constant in
`src/sim/constants.ts` and changes it live. `docs/PLAYTEST.md` lists what only a thumb can judge and
which constant controls each.

## Where things are decided

- `docs/DESIGN.md`: the spec.
- `docs/PLAN.md`: milestones and progress.
- `docs/DECISIONS.md`: decisions and cuts made along the way, with reasons.
- `CLAUDE.md`: conventions and commands for working in the repo.
