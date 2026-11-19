# Art pass: rules common to the four art briefs

The owner asked for real graphics: characters, weapons, abilities, points of interest. Four tasks
run at once, each on its own views. The lead is building, at the same time, a way to switch the
whole game between a few looks (palette, light, fog, outlines, pixel size) from `src/render/look.ts`
and `src/render/scene.ts`. Your work must survive that, so:

## Rules

- **One style: chunky low-poly toys.** Flat-shaded facets, thick limbs, big heads and hands,
  exaggerated silhouettes that read at 30 m on a phone held upright. Think vinyl figures and
  skatepark furniture, not realism. No smooth shading, no textures, no thin details under 8 cm.
- **Colour comes from `PALETTE`** (`src/render/look.ts`) and nowhere else. A model is two or three
  tones of its palette colour, made with `tone(color, k)` (darker underside and feet, lighter
  accents), baked as vertex colours. Read `PALETTE` when the view is constructed, never at module
  scope (a look replaces its values before the views are built). Do not add palette entries; if
  you truly need a colour that is not there, say so in your report.
- **Materials come from `flatMaterial` / `glowMaterial`** in `look.ts` and the helpers built on
  them in `fxView.ts` (`fadeMaterial`, `discMaterial`, `tintMaterial`). No new material types, no
  textures, no post-processing, no lights, no shadows.
- **Living things have a face.** Every enemy and the rider gets something that reads as eyes or a
  visor on its front, so which way it faces is obvious and it reads as a creature.
- **Things move.** Idle and travel motion in the vertex shader or by per-part transforms written
  into existing buffers. No per-frame allocation, no per-enemy `Object3D`.
- **Budgets.** Triangles: rider at most 700; ordinary enemy at most 110 (gnat 30); boss at most
  500; a map thing at most 150. The perf scenes (`node tests/perf/run.mjs`) must stay under 40
  draw calls and 200,000 triangles with the horde, 34 and 150,000 without; the lead has raised
  `tests/perf/budgets.json` to that. Frame time on this machine is noisy while other tasks run:
  report it, and do not chase it unless your change clearly made it worse on a quiet rerun.
- **The sim is read-only.** Views read sim state and never write it. Nothing in `src/sim/` is
  yours. If you need a number the sim does not expose, say so.
- **Rules of the game:** how fast the rider moves never changes damage dealt, damage taken or
  healing. Nothing you draw may suggest it does (no "speed = power" cues).
- **Screenshots are the acceptance.** For each thing you draw, a screenshot at 390x844 where it
  can be judged (the e2e routes save to `artifacts/screens/`; extend your route or add shots to
  it). Look at each with the Read tool and say in your report what you see and what is still
  weak. A before/after pair for the two or three biggest changes.
- Existing unit tests for your views assert behaviour (what is drawn when); keep them passing
  and add to them for what you add. Never weaken one.
- The common rules in `docs/briefs/README.md` apply: fresh worktree, `npm ci`, small commits that
  say why, no push, no merge, report without file contents.
