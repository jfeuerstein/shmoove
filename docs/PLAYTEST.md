# Playtest: what only a thumb can judge

The bots already check what a machine can: the stick alone stays slow, a good line reaches gear 5,
sloppy hopping costs speed, letting go never leaves you stuck, and every run replays exactly. This
list is the rest. It is the M1 go / no-go: play each scheme for five minutes, then pick one or send
it back with notes.

Open the game link with `?debug` on the end (for example `.../?debug`). A round button at the top
right opens the feel panel over the right of the screen; the game keeps running on the left. The
scheme buttons are at the top of the panel, then one section per group with a slider for every
number. Changes stick between visits. **Reset all** puts everything back.

To start on a scheme straight away: `?debug&scheme=tuck`, `?debug&scheme=lift`,
`?debug&scheme=swipe`. `&seed=2` (any whole number) gives a different bowl.

## The three schemes, five minutes each

Play them in this order, on the same bowl, holding the phone in one hand.

### Tuck (the pitch's scheme)

Thumb down and drag to carve; lift the thumb to tuck and coast; a quick tap to hop.

- Spend the first minute just carving on the floor. Then find a downhill, lift your thumb, and
  feel the speed build. Then tap right as you land and try to keep a chain of clean hops going (the
  chain count shows under the gear).
- Notice: does a tap ever carve, or a short drag ever hop? Does lifting to tuck feel like letting
  go of the brakes, or like losing control? Can you tap within the landing window without staring?
  Does reaching gear 4 or 5 feel earned?

### Lift

Drag to carve; hold still with the thumb down to tuck; lift the thumb to hop.

- Same minute of carving, then try hopping by lifting at each landing.
- Notice: does every lift becoming a hop cause hops you did not want (say, when you just wanted to
  rest your thumb)? Is holding still a natural way to tuck? Is it easier to time landings than with
  taps?

### Swipe

Drag to carve; flick up while your thumb is down to hop; taps do nothing.

- Carve, then flick up at each landing without lifting.
- Notice: do flicks ever fail, or do fast pushes up the screen hop when you only meant to steer
  forward? Does keeping the thumb down the whole time tire it? Does the stick still steer where you
  expect right after a flick?

For every scheme: is the floating stick under your thumb where you expect it, and does the ring
show and hide at the right moments?

## The numbers to judge by thumb

Grouped as in the panel. Each shows its value as shipped. If one feels wrong, move its slider, play
a minute, and keep the value that feels right. The numbers the bots pin (gear speeds, boost pads,
the clean-hop bonus, the speed limit) are not on this list.

### input

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `stickRadiusPx` | 56 px | the stick slams to full with a twitch; no fine steering | a long thumb reach before you turn hard |
| `stickDeadPx` | 8 px | resting thumb jitter steers you | small corrections do nothing |
| `tapMaxMs` | 180 ms | quick taps sometimes carve instead of hopping (tuck scheme) | a short press-and-drag hops when you meant to carve |
| `tapSlopPx` | 12 px | taps that wander a little become carves | small deliberate drags become hops |
| `swipeSpeed` | 1.2 px/ms | steering forward fires hops (swipe scheme) | flicks fail unless violent |
| `swipeMinPx` | 28 px | tiny twitches hop (swipe scheme) | flicks need a long stroke |

### run

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `runSpeed` | 10 m/s | the stick is sluggish, carving feels pointless | the stick alone is fast enough; tuck and terrain stop mattering |
| `runAccel` | 22 m/s² | slow to get going, heavy | instant top speed, no weight |
| `idleBrake` | 5 m/s² | thumb down with no drag keeps rolling | thumb down with no drag stops you like a wall |

### carve

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `turnMax` | 5.5 rad/s | slow, wide turns when slow | twitchy spins at walking pace |
| `grip` | 34 m/s² | at speed you cannot turn, you slide wide | at speed you turn on a coin with no commitment |
| `carveScrub` | 0.1 | hard turns at speed cost nothing | every correction at speed feels like braking |
| `carveDrag` | 0.4 /s | you can hold the stick at speed for free, so there is no reason to tuck | touching the stick at speed feels like braking |
| `carveSlopeGain` | 0.2 | downhills do nothing unless you let go | carving downhill builds speed like a tuck, so there is no reason to tuck |
| `slideAngle` | 1.9 rad | pulling the stick a little back throws a U-turn | you have to pull straight back to get the U-turn |
| `slideTurn` | 2.2 | the U-turn swings wide | the U-turn snaps round |
| `slideBrake` | 14 m/s² | U-turns keep all your speed | U-turns stop you dead |

### tuck

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `tuckDrag` | 0.03 /s | a tuck on the flat never slows | a tuck on the flat dies quickly |
| `rollFriction` | 0.4 m/s² | gentle slopes roll you forever; hard to stop | you stall on slopes that look downhill |

### hop

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `hopSpeed` | 7 m/s | a hop barely leaves the ground | floaty; long waits for the next landing |
| `hopBufferTicks` | 9 ticks (0.15 s) | early taps are eaten | taps well before landing still count; feels automatic |
| `cleanWindowTicks` | 7 ticks (0.12 s) | clean hops need perfect timing | chains are free, no skill |
| `landScrub` | 0.08 | missing a hop costs nothing | missing a hop feels like a crash |
| `minAirTicks` | 4 ticks | tiny bumps count as landings (hop prompts everywhere) | small kicker landings do not count for a chain |

### air

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `gravity` | 25 m/s² | moon jumps; slopes pull weakly | short hops; slopes yank you |
| `airTurn` | 1.2 rad/s | no steering once you leave the ground | you steer in the air as well as on it |

### ground

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `stickAccel` | 18 m/s² | every crest throws you into the air | you never fly off crests and kickers |

### gears

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `gearHyst` | 1 m/s | the gear flickers at the edge of a gear | the HUD shows a gear you are no longer going |
| `gearDropTicks` | 12 ticks (0.2 s) | a hop or a turn drops the gear | the gear hangs on long after you slowed |

### view

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `viewFollow` | 3.2 /s | the view lags your turns; the stick feels wrong after a turn | the view whips round; holding the stick sideways spins you |
| `viewMinSpeed` | 2 m/s | the view swings around when you are nearly still | slow turns do not bring the view round |

### camera

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `camDist` | 7 m | too close, cannot see the line | the mover is a speck |
| `camHeight` | 5.5 m | flat view, the ground ahead is hidden | looking straight down, no horizon |
| `camLookAhead` | 4 m | the mover sits mid-screen, little ahead shown | the mover sits at the bottom edge under the thumb |
| `camLookAheadPerGear` | 1.2 m | fast gears show no more of what is coming | the mover drops under the thumb at speed |
| `camFov` | 74° | tunnel vision | fisheye, speed feels slow |
| `camFovPerGear` | 3° | no sense of speed when the gear goes up | the edges stretch at gear 5 |
| `camPosRate` | 9 /s | the camera drifts behind, floaty | every bump shakes the camera |
| `camLandKick` | 0.05 m per m/s | landings have no weight | landings shake the screen |

## The horde slice (M2)

The game link opens straight into a three-minute run: the horde rises around you, contact below
gear 3 hurts, the trail behind you burns, closing a loop pops everything inside it, and Seekers fire
by distance once the first level grants them. `?solo` gives the bowl without the horde.

Play three runs, on the scheme you picked:

1. **Hold the stick and dodge.** Stay in gear 2, never tuck. Notice: how long until the first hit,
   and is it fair (did you see it coming)? After a hit, does the shove give you room to get away,
   or are you hit again before you can steer? Is the first level-up (Seekers) soon enough that you
   can hurt what is in front of you?
2. **Loop.** When a crowd follows you, turn round it and close the trail. Notice: can you tell
   when a loop will close? Does a pop feel worth the risk of turning into the crowd? Is the trail's
   length in gear 2 enough to circle a crowd without touching it?
3. **Ride lines.** Tuck downhill, chain hops, use pads and pipes, plow through the small ones in
   gear 3. Notice above all **what happens when you drop out of gear 3 in the middle of a crowd**:
   the bots say this is where line riders take most of their hits. Does gear 3 and up feel safe,
   or does the run feel the same as the dodging one? Does a bollard ever stop you without warning?

For every run: when you die, was it the horde getting bigger or something you did? A thumb's
answer to that is the most useful thing this slice can tell us.

### combat

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `invulnTicks` | 48 ticks (0.8 s) | hit after hit with no time to steer away | brushing through a crowd after a hit is free |
| `hitShoveRadius` | 7 m | after a hit you are still touching the crowd | a hit clears the screen; getting hit is a tactic |
| `hitShoveSpeed` | 12 m/s | the shove is a nudge; the crowd closes again at once | enemies fly away like ragdolls |
| `hitStunTicks` | 44 ticks | thrown enemies come straight back at you | after a hit the crowd stands about harmless for too long |
| `plowSpeedCost` | 0.25 m/s | plowing a crowd costs nothing; gear 3 is armour | plowing a few drops you out of gear 3, into the crowd |
| `plowShove` | 7 m/s | plowed enemies stay in your path | plowed enemies fly off; no sense of mass |
| `bonkBounce` | 3 m/s | a bollard is glue | a bollard is a trampoline |

### wake

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `wakeLength` | 34 m | no room to circle anything in gear 1 and 2 | loops close by accident; the trail is a wall |
| `wakeLengthPerGear` | 5 m | going fast does not help looping | at speed the trail covers the map |
| `wakeLifeTicks` | 420 ticks (7 s) | the trail vanishes before you can come back to it | an old trail closes loops you did not mean |
| `wakeWidth` | 1.1 m | enemies cross the trail unburnt | the trail is a moat |
| `wakeCloseDist` | 2.6 m | you pass right by your trail and it does not close | loops close when you were only near the trail |
| `wakeLoopMinArea` | 18 m² | a thin strip beside your own trail pops | small, honest loops do not count |
| `wakeLoopMin` | 16 m | tiny wiggles pop | you need a huge circle before anything pops |

## Sending it back

In the panel, press **Copy changes**. It copies the scheme you were on and every number you moved,
one per line (if the phone will not copy, the text appears in a box to select by hand). Paste that
into your message, then add in plain words: which scheme you pick (or that none of them works), and
anything that felt wrong that no slider fixed.
