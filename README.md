# SHMOOVE

A one-thumb 3D survivor for a phone held upright, where your speed is your build. Carve, tuck and hop
around a giant bowl; your weapons fire themselves, count metres instead of seconds, and hit harder in
every gear.

**Where it is:** the feel slice. One mover on a seeded bowl, three one-thumb control schemes to
compare, a debug panel to tune every feel constant on the phone. No enemies yet.

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
