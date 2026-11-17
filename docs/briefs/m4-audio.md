Your role and rules are defined in `.claude/agents/implementer.md` in this repo: read that file first and follow it exactly (ignore its YAML frontmatter). Then read `CLAUDE.md`, `docs/DESIGN.md` (sections 5 and 8 closely, 9 and 11 for context) and these contract files: `src/sim/types.ts` (SimEvent, Mode), `src/sim/lines.ts` (LineDef/CompiledLine: `district`, `stem`, `kind`), `src/sim/world.ts` (Surface, District).

You are the implementer for task M4-AUDIO on SKITCH: all sound, synthesised with the Web Audio API. No audio files, no libraries.

## Goal
A self-contained audio system the app drives with sim state and events: four district tracks (cumbia, funk, highlife, city pop) each in four stems (perc, bass, harmony, lead), a stem mixer that follows hitch/chain/bail, and the non-musical layer (wheels, wind, ride motors, grind, landing, bail, UI ticks). It must sound deliberate and musical, loop seamlessly, and cost little CPU on a phone.

## Files you own
- `src/audio/**`
- `tests/unit/audio/**`
Nothing else (the lead wires it into the app). No new dependencies.

## Interface to export from `src/audio/index.ts`
```ts
import type { SimEvent } from '../sim/types';
import type { CompiledLine } from '../sim/lines';

export interface AudioView {
  /** Mode value from src/sim/types.ts. */
  mode: number;
  /** m/s. */
  speed: number;
  /** Surface under the wheels (Surface enum) or -1 in the air. */
  surface: number;
  /** Links in the current chain (0 = none) and whether it is alive in flight. */
  chain: number;
  chainAlive: boolean;
  /** Index into `lines` of the line hitched to, or -1. */
  hitchedLine: number;
  /** District (0..3) the skater is in. */
  district: number;
  /** 0..1, 0 = midnight. */
  dayFrac: number;
  /** Distance in metres to the nearest active ride vehicle, its kind, or Infinity/null. */
  nearRideDist: number;
  nearRideKind: string | null;
  paused: boolean;
}
export interface AudioDebug {
  running: boolean;            // AudioContext exists and is running
  track: number | null;        // district index of the playing track
  stemTargets: [number, number, number, number]; // mixer target gain 0..1 per stem (perc, bass, harmony, lead)
  fullBand: boolean;
  wheelLevel: number;          // 0..1
  bar: number; beat: number;   // transport position
}
export interface AudioSystem {
  /** Call from a user gesture. Creates or resumes the AudioContext. Idempotent; never throws (a browser without Web Audio leaves the system silently inert). */
  unlock(): void;
  /** Once per rendered frame, with every sim event since the previous call. */
  update(view: AudioView, events: readonly SimEvent[], lines: readonly CompiledLine[], dtSeconds: number): void;
  setMuted(muted: boolean): void;
  setVolumes(music: number, sfx: number): void; // each 0..1
  /** One-shot UI sounds: 'tick' (flap of a destination board), 'punch' (ticket punched), 'ink' (line segment inked), 'fanfare' (line or errand complete), 'deny'. */
  ui(name: 'tick' | 'punch' | 'ink' | 'fanfare' | 'deny'): void;
  debug(): AudioDebug;
  dispose(): void;
}
export function createAudio(): AudioSystem;
```

## Structure (required, so the logic is testable without Web Audio)
- `src/audio/mixer.ts`: a pure state machine, no Web Audio, no DOM, no timers. Input: AudioView + events + lines + dt. Output: which track (district) should play, a target gain per stem, whether the full band is in, fade times, and discrete cue requests (one-shots). This is where the rules live.
- `src/audio/tracks/*.ts`: pattern data for the four tracks as plain data (steps, notes, velocities), plus a pure validator.
- `src/audio/transport.ts`: pure bar/beat/step arithmetic and the lookahead scheduler logic, taking "now" and "scheduled until" as numbers (no AudioContext inside), returning the list of steps to schedule with their times. Stem starts are quantised to the next beat.
- `src/audio/synth.ts`, `src/audio/engine.ts`: the Web Audio side (voices, buses, compressor, the per-stem GainNodes, noise sources), thin and driven by the pure parts.

## Mix rules (from DESIGN section 8; implement exactly)
- Always: wheel noise (filtered noise; level and filter cutoff rise with speed; STAIRS adds a clattering amplitude modulation at a rate tied to speed; GRASS/DIRT are duller; silent in the air), wind (rises with speed in the air and is always present a little in district 3), ride motors/rumble when a vehicle is within ~25 m (different timbre for tram/funicular vs engine vehicles vs cable car/kite hum).
- Hitching a line (event `hitch`) selects that line's home district track (`lines[e.line].district`) and fades in that line's stem (`lines[e.line].stem`), starting on the next beat. If a different track was playing, it cross-fades over one beat and the stem set resets to this line's stem (plus full-band rule below).
- Stems of earlier links in the current chain stay in while the chain lives (same track only).
- A chain of 3 or more brings in the full band (all four stems) of the current track.
- When the chain ends by landing (`chainEnd` reason 'land', or a release followed by the chain lapsing), stems fade out over two bars. While merely released and flying with the chain alive, keep the stems.
- `bail` cuts music to silence within 60 ms, leaving only wheel/tumble noise; music returns only with the next hitch.
- Hitching with no chain (a fresh first link) starts with exactly that one stem.
- One track at a time: the track of the most recent hitch.
- Paused: everything ducks to silence over 150 ms and the transport holds.
- One-shots from events: `hop` (short pitched thump), `land` (thud scaled by impact; AWNING/`bounce` gets a springy boing), `grindStart`/`grindEnd` (a sustained metallic scrape between them, pitch following speed), `wallStart`/`wallEnd` (scuff), `release` (a whoosh whose pitch follows speed, plus a rising arpeggio note per chain link: link n plays the nth note of the current track's scale), `denied` (a flat double buzz), `bail` (crash + scatter), `kickturn` (tiny scuff).

## The tracks
Each is 8 bars of 4/4 at 16 steps per bar, loops seamlessly, and is written so any subset of stems sounds intentional (a lone bass or lone perc stem must still groove). Give each real harmonic movement (at least a 4-chord progression over the 8 bars) and a memorable lead hook.
- District 0 Docks, cumbia, 92 bpm, A minor: guacharaca scrape pattern + kick on 1 and 3 + conga accents; tumbao-style bass (root-fifth with the characteristic anticipations); accordion-like stabs (two detuned reedy saws/squares through a bandpass, off-beat chords); clarinet-like lead (filtered square/triangle with vibrato).
- District 1 Mercado, funk, 104 bpm, E minor (dorian): tight kick/snare/closed-hat with ghost notes and a 16th-note hat; syncopated slap-ish bass (short plucky saw with a fast filter envelope, octave pops); wah-clav harmony (bright pulse through an envelope-swept bandpass, 16th-note scratches); horn-section stabs as the lead (stacked saws in fifths/octaves with a brassy filter attack).
- District 2 Terraces, highlife, 116 bpm, G major: bell/clave timeline pattern + shaker + soft kick; walking, melodic bass; palm-wine guitar arpeggios (plucked, Karplus-Strong or a short bright filtered pluck, interlocking two-part 8th/16th pattern); horn lead melody in thirds.
- District 3 Antenna Hill, city pop, 100 bpm, F major with maj7/9 chords (e.g. Fmaj7 – Em7 – Dm7 – G7 style movement adapted to the key): gated-reverb-style kit (snare with a short noise tail), octave synth bass; electric-piano pads (FM-ish: sine carrier + sine modulator with decaying index, slight chorus by detune); glassy bell lead.
Shared: a light master compressor/limiter so stems summing cannot clip, a short feedback delay send for leads, no convolution reverb (too costly). Voice count stays small: no more than 24 simultaneous oscillator/buffer nodes in steady state; reuse one noise buffer.

## Acceptance tests (in `tests/unit/audio/`, Vitest, node environment, no Web Audio available: test the pure parts)
1. Mixer: a `hitch` on a line with district 2, stem 1 selects track 2 and targets stem 1 only; a second link on another line of the same district adds its stem; a third link sets fullBand and all four targets to 1; `chainEnd` 'land' sends all targets to 0 with a two-bar fade; `bail` sends targets to 0 with a fade of at most 60 ms and music stays off until the next `hitch`; a hitch on a line of another district switches track and resets stems to that line's stem; released-but-alive keeps stems; paused ducks everything. Wheel level rises monotonically with speed on the ground and is 0 in the air.
2. Tracks: every track validates (8 bars x 16 steps per stem, note numbers within sane ranges for the stem, every stem non-empty in every 2-bar window, tempo and key as specified, at least 4 distinct chord roots in the harmony stem across the loop).
3. Transport: the scheduler never schedules a step twice or skips one across irregular `now` advances (including a long stall), stem-start quantisation always lands on a beat boundary at or after "now", bar/beat math wraps at 8 bars.
4. `createAudio()` in a Node environment without `AudioContext`: `unlock`, `update`, `ui`, `setMuted`, `dispose` do not throw and `debug().running` is false while mixer fields in `debug()` still follow the events.
5. `npm run typecheck`, `npm run lint`, `npm test` pass (existing tests stay green).
Also verify by hand in the real browser: write a throwaway Node script using the preinstalled `playwright` (`chromium.launch()`, no install; see `tests/e2e/lib/browser.mjs` for working launch flags) that loads a tiny temporary HTML page importing your built module via the Vite dev server or `vite build` output, calls `unlock()` after a synthetic click, feeds a few events, and confirms no console errors and `debug().running === true` with `AudioContext.currentTime` advancing. Do not commit the throwaway script or page; report what you observed.

## Return
A short summary: the architecture in a few lines, per-track description (progression, hook), measured node counts, anything you could not verify by ear (you cannot listen, say so plainly and list what a human should check), deviations from this brief. The commands you ran with pass/fail. The list of changed files. No file contents. Commit on your current branch in small commits; do not push or merge.
