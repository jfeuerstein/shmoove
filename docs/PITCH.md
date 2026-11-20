# SHMOOVE: the pitch

**A one-thumb 3D survivor on a skateboard.**

A horde closes in on a giant skate bowl. Your weapons fire themselves, the dead drop sparks, sparks
are levels, levels are cards. That part is the genre, played straight. What is different is how you
get about: you are on a board. Push, coast, ollie, drop into a half-pipe, launch off a kicker, and
be somewhere else before the horde arrives.

Portrait. One thumb. Ten-minute runs. Installs from a link.

Everything numeric below is a starting value for the debug panel, not a promise.

> **This is the second pitch.** The first made speed the stat everything ran on: weapons fed by
> metres, damage and healing by gear, contact that hurt or plowed depending on how fast you were
> going. The owner played it and wanted the movement to be fun, not a system to manage: "a pretty
> standard survivor-like but with fun movement. Think Megabonk but with a grappling hook or
> skateboard." The rules below are the genre's. The movement is the toy.

## 1. Pillars

| Pillar | What it means in practice |
| --- | --- |
| **A survivor first** | Weapons fire on timers whether you move or not. Touching an enemy hurts. Kills drop sparks; sparks are levels; a level is three cards. Nothing about fighting depends on how fast you are going. |
| **Movement is the toy** | The board is why this one is fun to play. Speed is for getting to the chest, getting round the crowd, and getting air, because those feel good, not because a number goes up. |
| **One thumb** | Drag to steer, let go to coast, tap to ollie. Nothing else is ever required, and none of it needs explaining twice. |
| **The map is a skatepark** | Slopes, half-pipes, kickers, pads, and things to ride through. Learning the bowl makes you harder to catch. |

## 2. Controls

One thumb, anywhere on the lower two thirds of the screen.

| Gesture | What it does |
| --- | --- |
| Hold and drag | Steer, and push up to run speed. Downhill you go faster than that whether you hold on or not. |
| Lift the thumb | Coast. You keep your speed and your heading. |
| Tap | Ollie. Tap again as you land and you keep your speed and add a little; chain them. |

Pulling the stick back toward you is a U-turn. A second thumb is optional: any second touch is an
ollie. Two alternates for the tap (lift to hop, swipe to hop) are in the debug panel.

There is nothing to learn before you can play: drag and you go.

## 3. What speed is for

Not for damage and not for health. For:

- **Getting away.** The horde runs at 4 to 10 m/s. You push at 10 and a good hill gives you 25.
- **Getting over.** An ollie clears everything but the big ones (a bollard, a boss).
- **Getting to things.** Crates, shrines, slaloms and hoops are spread across the bowl.
- **Feeling good.** The camera pulls back, the music fills in, the board hums.

The speed tiers (gears 1 to 5) still exist under the hood for the camera and the sound. They are
not a rule the player has to know.

## 4. A run

Ten minutes on one map. Pause or leave at any time; the run resumes.

| Time | What happens |
| --- | --- |
| 0:00 to 3:00 | Shufflers and gnats. Take the first cards. |
| 3:00 | Mini-boss. |
| 3:00 to 6:00 | Cutters and lobbers join. |
| 6:00 | Mini-boss. |
| 6:00 to 9:00 | Everything, plus elites, tar and clingers. |
| 9:00 | The boss. |
| After | Win and bank it, or stay for Overtime. |

**Levelling.** A level is three cards: a new weapon, a level on one you carry, or a passive. Four
weapon slots, four passive slots, five levels each. The world holds still while you choose and
gives you your speed back after.

## 5. The arsenal

Every weapon fires itself on a timer. You start with the Seekers.

| Weapon | What it does |
| --- | --- |
| **Seekers** | Homing darts at whatever is nearest. |
| **Wake** | A burning trail behind the board. Ride a loop round a crowd and it pops. |
| **Bumper** | When you are hit, everything near you is hurt and thrown back. |
| **Slam** | A shockwave round you, every few seconds. |
| **Orbit** | Discs circling you. |
| **Static** | A bolt that chains through a line of enemies. |
| **Skipper** | Stones that skip from one enemy to the next. |
| **Slipstream** | Your draft drags sparks and small enemies into your trail. |
| **Crumbs** | Mines dropped behind you. |
| **Lance** | A beam straight ahead. |

**Passives:** Might (damage), Haste (fire rate), Wide Load (area), Heart (health), Regen, Hide
(armour), Magnet, Luck, and three for the board: Wax (roll further), Springs (higher ollies), Wings
(more control in the air).

## 6. The horde

| Enemy | Behaviour |
| --- | --- |
| **Shuffler** | Slow, endless, the bulk of it. |
| **Gnats** | A fast cloud with almost no health. An ollie clears them. |
| **Bollard** | Heavy, slow, in the way. You do not push through it. |
| **Cutter** | Fast, and runs for where you will be. |
| **Lobber** | Keeps its distance and lobs shots that land in rings you can see coming. |
| **Sludge** | Leaves tar that slows the board. |
| **Clinger** | Grabs on and drags until an ollie shakes it off. |

Elites are bigger, tougher versions with an aura. Target: 400 enemies alive at 60 fps on a
mid-range phone.

## 7. The map

**The Bowl.** About 340 m across, generated from a seed: a banked rim that turns you round
instead of stopping you, rolling hills, a crater, two half-pipes, kickers, boost pads, and eight to
twelve rails.

| Thing | How you use it | Reward |
| --- | --- | --- |
| **Crate** | Ride into it. | A card, a heal, a magnet or a bomb |
| **Shrine** | Ride into its ring. | Pick one of three boons |
| **Slalom** | Ride between five gates in order, the next one lit. No clock: the gates taken are kept. | XP and tokens |
| **Hoop** | A big ring on top of a kicker: ride or ollie straight through it. | Tokens; a streak bonus |
| **Totem** | Ride into it to call an elite pack on purpose. | A rare card when its elite falls |
| **Rail** | Ollie onto it. The rail steers; you pick up speed. Ollie off, or ride off the end. | Speed, and a lane above the small enemies' reach |

Near enough to use, each one wears a small label saying what it is and what to do (`SHRINE · ride
in`, `GATES 2/5`); from afar, all but the plain crates show a beacon.

To come: more of the park (see `PLAN.md`).

## 8. Between runs, look, sound, platform

Unchanged from the first pitch in outline: tokens, five riders, unlocks by feats, records and a
daily bowl; flat-shaded low-poly with a dark ground and saturated enemies; a generated funk loop
in stems that follow your speed; TypeScript, Three.js and Vite as an installable offline PWA; a
deterministic 60 Hz sim so bots can play whole runs in tests.

## 9. Decided

- **Skateboard, not grappling hook.** The owner named both and then chose the board.
