# Playtest: what to do, what to measure, what only a thumb can judge

The game measures the playtest itself. Every run ends with a **COPY REPORT** button on the end
card, and the last ten runs are kept under **REPORTS** on the pause sheet (**COPY ALL** there copies
the lot). A report is about twenty lines you can read followed by one line of data. Paste them
back and most of the questions below are answered with numbers.

The bots check what a machine can (`npm run balance`, results in `tests/balance/last.json`):
standing still dies inside the first minute, holding the stick blind dies inside the first act, a
careful bot reaches the final boss on most seeds and usually clears, and a bot that also rides the
board does at least as well. What they cannot tell is whether any of it is fun, fair or readable.

## How to start

Open the game link on the phone, upright, sound on. It starts a ten-minute run on the **tuck**
scheme: thumb down and drag to steer, lift the thumb to coast, a quick tap to ollie. Weapons fire by
themselves; touching an enemy hurts; how fast you go never changes how hard you hit or how much a
hit hurts. The pause button is top right; the game also pauses itself if you leave the page.

Useful link endings: `?debug` (the feel panel: a round button at the top right; changes stick
between visits, **Reset all** undoes them), `?seed=2` (any whole number: another bowl and run),
`?nolesson` (skip the first-run lesson), `?scheme=lift` or `?scheme=swipe` (the other two
schemes), `?mute`, `?look=night`, `?look=pool`, `?look=tape`, `?look=riso` (the four looks; the
pause sheet has a button that steps through them too).

## The session: about 45 minutes

| Step | What to do | Why |
| --- | --- | --- |
| 1 | **Run 1, cold.** Read nothing. Do the lesson, play until the run ends. | Is it understood with no help? |
| 2 | **Runs 2 to 4.** Play to survive. Same look (NIGHT BOWL), any seed. | The learning curve and the balance. |
| 3 | **Run 5, the board run.** Go for rails, pads, kickers, hoops, slaloms, crates and a shrine on purpose. | Is the map worth using? |
| 4 | **Two minutes in each other look** (pause, LOOK button; it restarts the run). | Which look, and what each costs in frames. |
| 5 | Pause, **REPORTS**, **COPY ALL**, paste it back with the ratings at the end of this page. | The numbers. |

If the first run is over in under a minute, that is a result, not a mistake: carry on.

## What the reports measure, and what counts as right

Each row names the part of the report it reads. "Target" is what the design is aiming at; a miss
is something to fix or to argue with, not a failed test.

### Does it run

| Measure | In the report | Target | A miss means |
| --- | --- | --- | --- |
| Average frame | `frames.avgMs` | 17 ms or less (60 a second) | Performance first, before any other change |
| Slow frames | `frames.p95Ms`, `frames.p99Ms` | 22 ms and 34 ms or less | Stutter you can feel in steering |
| Hitches | `frames.over50` | 5 or fewer in a run | Something stalls: note when it happened |
| Under a big crowd | `frames.avgMsBigHorde` | 20 ms or less | The horde is too heavy for this phone |
| Each look | `frames.avgMs` by `look` | within 3 ms of NIGHT BOWL | That look's screen pass costs too much |

### Is it learnable

| Measure | In the report | Target | A miss means |
| --- | --- | --- | --- |
| The lesson | `lesson` (seconds per step) | every step under 20 s, all of it under 90 s | That step's words or its trigger are unclear |
| First run | `seconds` of run 1 | between 1:30 and 5:00 | Shorter: the start is too hard or the controls did not land. Longer: too easy |
| Getting better | `seconds` over runs 1 to 5 | later runs last longer; the Bruiser (3:00) is met by run 4 and felled once | Skill is not paying |
| Thumb on the screen | `movement.holdingShare` | 0.6 to 0.9 | Lower: coasting is too good. Higher: letting go is never right |
| Standing still | `movement.stillSeconds` | under 5% of the run | You stopped to read something the game should have made clear |
| Reading a card | `cards.perOffer` (seconds each) | most between 2 and 6 s | Slower: cards are unclear. Under 1 s: they are not being read |
| Cards a minute | `build.cards` against `seconds` | 3 to 5 a minute | More: levelling interrupts the riding (the bots get 5 to 8) |

### Is it fair

| Measure | In the report | Target | A miss means |
| --- | --- | --- | --- |
| Hits a minute | `taken.hits` against `seconds` | 2 to 6 in a run over three minutes | Fewer: too safe. More: dangers cannot be read in time |
| What hurts | `taken.byCause` | no one cause over half the hits | That enemy is unfair or cannot be seen |
| Seeing death coming | `taken.secondsLow` on a run that died | 5 s or more under 30% health | Deaths come from nowhere |
| Weapon shares | `damage.bySource` | with three or more weapons, none over 60% and none carried since before 3:00 under 5% | A weapon is the only answer, or a wasted card |
| The Bruiser | `bosses[0].lived`, `.hitsWhileUp` | 20 to 60 s; 1 to 6 hits | A wall or a pushover |
| The Mortar | `bosses[1]` | 25 to 75 s; 1 to 6 hits | The same |
| The Standstill | `bosses[2]` | 40 to 120 s; 1 to 6 hits | The same |
| The crowd | `horde.peak` on a run past 8:00 | 250 or more | The late game is thin |

### Is the board the fun part

| Measure | In the report | Target | A miss means |
| --- | --- | --- | --- |
| Ollies | `movement.ollies` against `seconds` | 4 a minute or more | The ollie is not worth tapping |
| Clean ollies | `movement.cleanOllies` over `ollies` | a quarter or more by run 3 | The landing window is too tight, or nobody knows it is there |
| Longest chain | `movement.longestChain` | 3 or more by run 3 | Chains are not discoverable |
| Time in the air | `movement.airSeconds` | 5% of the run or more | The bowl's ramps are not being used |
| Top speed | `movement.topSpeed` | 18 m/s or more | Hills and pads are not found |
| Fast riding | `movement.gearShare` (last two) | a fifth of the run or more | Speed is not worth having |
| Rails | `movement.railSeconds` | more than 0 from run 2; 10 s or more in the board run | Rails are missed or not worth it |
| Pads | `movement.padsHit` | 2 or more a run | Pads are not seen |
| The map | `map` | by run 3: three crates and one of shrine, slalom, hoop or totem in a run | Points of interest are not noticed or not worth the trip |

## Your first run: what to do, what to notice

1. **The first minute.** Keep moving. Steer away from the crowd and let the Seekers shoot. Take
   the first cards as they come. Notice: how long until the first hit, and did you see it coming?
   Does the first level come soon enough to feel you are hitting back? If you stop and stand, you
   should be overrun well inside a minute: is that how it feels, or does standing look safe?
2. **Up to 3:00.** Gnats come at 0:40 (an ollie clears them, and shufflers and cutters too), bollards at 2:00 (heavy and too tall to ollie: you do not
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
   from its run-up), crates (a card, a heal, a magnet or a bomb), shrines (circle one once: its
   dashes light as you pass them), slaloms (the dotted line to the next gate runs out in 5 s) and
   hoops (ollie near the kicker's lip, through the ring). Notice: does each thing say what it wants
   without words, and does using the map feel worth the detour, or is it safer to ignore it?

## Ratings to send with the reports

One number each, 1 (bad) to 5 (good), and a sentence where it is under 4.

1. Steering: does the board go where the thumb means?
2. The ollie: is the tap reliable, and is landing a clean one learnable?
3. The camera: can you see what you need to?
4. Sound: the mix, and whether the music is something you would leave on.
5. Hits: do the shake, the flash and the buzz tell you what happened without being too much?
6. Telling enemies apart at a glance.
7. Seeing dangers in time: lob rings, tar, the Bruiser's lane, the Standstill's rings, the edge markers.
8. The cards and icons: clear with one thumb?
9. Each boss, one number each: a fight you understood?
10. The four looks, ranked best to worst, with the one you would ship.

## What to report back in words

- When you died: what did it, and did it feel like your mistake or the game's?
- Which minute felt too easy, and which too hard? The bots say the first act is where careful
  players are most often lost, and that a strong build is rarely threatened after 6:00.
- Any weapon you would never take again, or always take. The Bumper (a short pulse every few
  seconds, and it hurts what a hit throws back) and the Slipstream (drags sparks and small
  enemies in behind you and wears down what is in its draft) are the two most in doubt.
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
| `hopSpeed` | 8.5 m/s | an ollie barely clears a shuffler or a ring | floaty; long waits before you can steer again; bollards can be jumped |
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
