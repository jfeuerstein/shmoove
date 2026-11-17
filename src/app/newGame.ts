/**
 * How a new game starts. Pure, so the sim tests can check the timetable against it.
 *
 * The clock is chosen so that the first ride arrives when the player does. From the lookout a new
 * player carves, hops and grinds down the Mercado Steps and reaches the landing of the first ground
 * stop on the way down, Rellano 410 (handcarts M2 and mopeds M1, 13-16 m east of the stairs on the
 * fourth landing), about 24 s after the start. At this time of day a moped is pulling out of that
 * stop as they get there, a handcart is trundling along the landing toward it (it reaches the stop
 * about 13 s later and is easy to catch at walking pace), and the next moped follows it in. A
 * player who arrives anywhere from 17 s earlier to 17 s later than that, and then carves around for
 * 20 s more, still finds a ride at the stop or due within 12 s (tests/sim/onboarding.test.ts checks
 * 15 s either way).
 */
export const NEW_GAME_DAY_FRAC = 0.4036;

/**
 * A boot is a new game (the new-game clock, and the lesson follows the hints setting) unless it is a
 * fixture: an explicit clock (`t=`), the feel slice or a scripted route. A loaded save keeps its own
 * clock and lesson state either way.
 */
export function isFixture(p: { t: number | null; slice: boolean; route: string | null }): boolean {
  return p.t !== null || p.slice || p.route !== null;
}
