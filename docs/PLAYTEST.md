# Playtest: what only a thumb can judge

The bots check what a machine can (see `npm run balance` and `tests/balance/last.json`): standing
still dies inside the first minute, holding the stick blind dies inside the first act, a careful
bot that keeps away from the crowd and fights each boss its own way reaches the final boss on most
seeds and usually clears, and a bot that also rides the board does at least as well. Every run
replays exactly. What they cannot tell is whether any of it is fun, fair or readable. That is this
list.

## How to start

Open the game link. It starts a ten-minute run on the **tuck** scheme: thumb down and drag to
steer, lift the thumb to coast, a quick tap to ollie. Weapons fire by themselves; touching an enemy
hurts; how fast you go never changes how hard you hit or how much a hit hurts.

Useful link endings: `?debug` (the feel panel: a round button at the top right; changes stick
between visits, **Reset all** undoes them), `?seed=2` (any whole number: another bowl and run),
`?nolesson` (skip the first-run lesson), `?scheme=lift` or `?scheme=swipe` (the other two
schemes), `?mute`.

## Your first run: what to do, what to notice

1. **The first minute.** Keep moving. Steer away from the crowd and let the Seekers shoot. Take
   the first cards as they come. Notice: how long until the first hit, and did you see it coming?
   Does the first level come soon enough to feel you are hitting back? If you stop and stand, you
   should be overrun well inside a minute: is that how it feels, or does standing look safe?
2. **Up to 3:00.** Gnats come at 0:40 (an ollie clears them), bollards at 2:00 (heavy: you do not
   push through). Pick a build. Notice: are the cards readable at a glance with one thumb? Does any
   weapon feel useless or like the only answer? Are you getting chipped down with no way to heal,
   and does that feel fair?
3. **The Bruiser at 3:00.** It walks at you, stops and faces where you will be (the tell), then
   charges in a straight line. Turn during the tell. Notice: can you read the tell on a phone?
   Does turning feel like the answer, and does the fight last long enough to be a fight (the bots
   take about 30 s)? Cutters arrive just after: they are faster than you on the flat and aim
   where you will be. Do they feel dodgeable or just unfair?
4. **3:00 to 6:00, then the Mortar.** Lobbers throw rings that land 1.1 s later where you would
   be; the Mortar lays a line of five across your path. Change line. Notice: are the rings readable
   in time, at speed, on the small screen?
5. **6:00 to 9:00, then the Standstill.** Sludge leaves tar, clingers grab on and drag (an ollie
   shakes one off; a hard landing shakes them all). The Standstill slows you near it and sends
   rings along the ground: ollie as the front reaches you. Notice: can you time the ollie over a
   ring by eye? Is the slow near it clear? The run is won when it falls.
6. **Ride the board.** On a second run, use the bowl: pads, the half-pipes, rails (ollie onto one
   from its run-up), crates (a card, a heal, a magnet or a bomb), slaloms and hoops. Notice: does
   using the map feel worth the detour, or is it safer to ignore it?

## What to report back

- When you died: what did it, and did it feel like your mistake or the game's?
- Which minute felt too easy, and which too hard? The bots say the first act is where careful
  players are most often lost, and that a strong build is rarely threatened after 6:00.
- Any weapon you would never take again, or always take. The Bumper (hurts what a hit throws back)
  and the Slipstream (drags sparks and small enemies) do no damage of their own: are they ever
  worth a slot?
- Each boss: was it a fight, too quick, or a slog? Did you know what it wanted you to do?
- Anything you could not read on the phone: a tell, a ring, tar, a card.
- From the feel panel, **Copy changes** and paste them in with a sentence on why.

## The numbers to judge by thumb

Each row shows the value as shipped. If one feels wrong, move its slider in the `?debug` panel,
play a minute, and keep the value that feels right. Numbers the bots pin (damage, health, the
director, the bosses) are not here: report how those feel in words.

### input

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `stickRadiusPx` | 56 px | the stick slams to full with a twitch; no fine steering | a long thumb reach before you turn hard |
| `stickDeadPx` | 8 px | resting thumb jitter steers you | small corrections do nothing |
| `tapMaxMs` | 180 ms | quick taps sometimes steer instead of hopping | a short press-and-drag hops when you meant to steer |
| `tapSlopPx` | 12 px | taps that wander a little become steering | small deliberate drags become hops |

### run and carve

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `runSpeed` | 10 m/s | you cannot get away from anything on the flat | nothing on the flat can catch you |
| `runAccel` | 22 m/s² | slow to get going after a stop or a hit | instant top speed, no weight |
| `turnMax` | 5.5 rad/s | slow, wide turns when slow | twitchy spins at walking pace |
| `grip` | 34 m/s² | at speed you cannot turn out of a charge or a ring line | at speed you turn on a coin with no commitment |
| `slideAngle` | 1.9 rad | pulling the stick a little back throws a U-turn | you have to pull straight back to get the U-turn |

### hop

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `hopSpeed` | 7 m/s | an ollie barely clears a gnat or a ring | floaty; long waits before you can steer again |
| `hopBufferTicks` | 9 ticks (0.15 s) | early taps are eaten | taps well before landing still count |
| `cleanWindowTicks` | 7 ticks (0.12 s) | clean hops (and shaking off a clinger) need perfect timing | clean hops are free |

### camera

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `camDist` | 7 m | too close: you cannot see what is coming | the rider is a speck |
| `camHeight` | 5.5 m | flat view: rings and tar on the ground are hidden | looking straight down, no horizon |
| `camLookAhead` | 4 m | the rider sits mid-screen, little ahead shown | the rider sits under the thumb |
| `camFov` | 74° | tunnel vision: things arrive from off screen | fisheye; distances are hard to judge |

### combat

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `invulnTicks` | 48 ticks (0.8 s) | hit after hit with no time to steer away | brushing through a crowd after a hit is free |
| `hitShoveRadius` | 5.5 m | after a hit you are still touching the crowd | a hit clears the screen; standing still and taking hits works |
| `hitShoveSpeed` | 12 m/s | the shove is a nudge; the crowd closes again at once | enemies fly away like ragdolls |
| `hitStunTicks` | 44 ticks | thrown enemies come straight back at you | after a hit the crowd stands about harmless for too long |

### wake (the Wake weapon's trail and loop)

| Constant | Now | Too low feels like | Too high feels like |
| --- | --- | --- | --- |
| `wakeLength` | 40 m | no room to circle a crowd | loops close by accident; the trail is a wall |
| `wakeWidth` | 1.1 m | enemies cross the trail unburnt | the trail is a moat |
| `wakeCloseDist` | 2.6 m | you pass right by your trail and it does not close | loops close when you were only near the trail |
