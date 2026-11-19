# SHMOOVE

A one-thumb 3D survivor on a skateboard, for a phone held upright. A horde closes in on a giant
skate bowl; your weapons fire themselves, the dead drop sparks, levels are cards. The board is how
you get about: push, coast, ollie, and be somewhere else before the horde arrives.

**Where it is:** a ten-minute run in three acts with two mini-bosses and a final boss, ten weapons,
eleven passives, seven kinds of enemy, a map full of things to ride through and rails to grind,
sound, and a first-run lesson. Being balanced and checked for a first full playtest.

```
npm ci
npm run dev        # then open the printed URL on a phone, or use arrow keys + space on a desktop
npm run gate       # typecheck, lint, test, build, e2e, pwa, perf
```

Add `?debug` to the URL for the feel panel, `?scheme=tuck|lift|swipe` to pick a control scheme,
`?seed=N` for a different bowl.

- [`docs/PITCH.md`](docs/PITCH.md): the game.
- [`docs/PLAN.md`](docs/PLAN.md): how it gets built, milestone by milestone, and the open questions.
- [`docs/PLAYTEST.md`](docs/PLAYTEST.md): what to try on the phone and what to report back.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): what was decided without the owner.
- [`CLAUDE.md`](CLAUDE.md): working rules for the build.
