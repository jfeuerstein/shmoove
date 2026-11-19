# M1: touch input

Model: sonnet. Read `docs/briefs/README.md` for the common rules, and `docs/PITCH.md` section 3.

## Goal

Turn one thumb on a touch screen into an `InputFrame` per sim tick, under three switchable control
schemes, with all the gesture logic testable without a browser.

## You own

`src/input/gestures.ts` (pure: no DOM, no clocks; time is passed in), `src/input/touch.ts` (binds
pointer and key events to it), `tests/unit/gestures.test.ts`.

## Interfaces

Already in the repo: `InputFrame` (`src/sim/types.ts`), `InputSource` and `Scheme`
(`src/input/source.ts`), and the tunables in `FEEL` (`src/sim/constants.ts`, group `input`):
`stickRadiusPx`, `stickDeadPx`, `tapMaxMs`, `tapSlopPx`, `swipeSpeed`, `swipeMinPx`. Read them from
`FEEL` at use, never copy them (the debug panel edits them live).

```ts
// gestures.ts
export interface StickView { active: boolean; ox: number; oy: number; x: number; y: number }
export class Gestures {
  constructor(scheme: Scheme);
  setScheme(scheme: Scheme): void;
  down(id: number, x: number, y: number, t: number): void; // CSS px, y down the screen; t in ms
  move(id: number, x: number, y: number, t: number): void;
  up(id: number, t: number): void;
  cancelAll(): void;
  sample(out: InputFrame, t: number): void; // fills out for the next tick; clears the hop edge
  readonly stick: StickView;                // for drawing: origin and thumb position
}
// touch.ts
export class TouchInput implements InputSource {
  constructor(el: HTMLElement, scheme: Scheme);
  readonly gestures: Gestures;
  setScheme(scheme: Scheme): void;
  sample(out: InputFrame): void;
  dispose(): void;
}
```

## Rules

Common to all schemes:

- The first pointer down is the thumb. While it is down, any other pointer going down is a hop and
  nothing else; it never steers.
- The stick is floating: its origin is where the thumb landed. Deflection is
  `(x - ox, oy - y) / stickRadiusPx`, length clamped to 1; within `stickDeadPx` of the origin it is
  (0, 0). If the thumb travels beyond `stickRadiusPx`, the origin is dragged along behind it so
  reversing is immediate.
- `sample` reports `hop: true` once if any hop was queued since the last sample; several collapse
  into one.
- `cancelAll` (pointer cancel, page hidden, window blur) clears everything: no carve, no hop.

`tuck` (the default): a new touch is undecided until it has moved more than `tapSlopPx` or is older
than `tapMaxMs`; until then `carve` is false. Released while undecided, it is a tap: hop. Once
decided it is a carve: `carve` is true until release, and releasing does not hop.

`lift`: `carve` is true whenever the thumb is down and outside the dead zone, false inside it. Every
release of the thumb hops, however long it was held.

`swipe`: `carve` as in `tuck`, but a tap does nothing. A flick hops: the thumb moving up the screen
faster than `swipeSpeed` px/ms over at least `swipeMinPx`, measured over the last 120 ms. One hop per
flick; it re-arms when the upward speed falls below half the threshold. The stick origin moves with
the flick, so the deflection after a flick is what it was before it. Releasing never hops.

`touch.ts`: pointer events on `el` (`pointerdown/move/up/cancel`, non-passive, `preventDefault`,
pointer capture), times from `performance.now()`. Calls `cancelAll` on `visibilitychange` and window
`blur`. For desktop development: arrow keys or WASD act as a full-deflection stick with `carve`
true while any is held; Space is a hop. `dispose` removes every listener.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` pass.
2. `tests/unit/gestures.test.ts` covers, as event sequences with explicit times: per scheme, a tap,
   a long press without movement, a drag in each direction (correct signs: right is +x, up the
   screen is +y), release after a drag; the dead zone; clamping; the dragged origin and an immediate
   reversal; second-finger hop in every scheme; hop reported once then cleared; hops collapsing;
   `cancelAll` mid-drag; a flick up while carving in `swipe` (hops once, deflection unchanged after),
   a slow upward drag in `swipe` (no hop), two flicks in a row; changing a `FEEL` input value
   between events takes effect; `setScheme` mid-touch does not leave a stuck carve.
3. No allocation in `move` or `sample`.
