import { describe, expect, it } from 'vitest';
import { DAY_TICKS } from '../../../src/sim/constants';
import { dayFrac } from '../../../src/sim/lines';
import {
  boardText,
  clockMinutes,
  clockText,
  countdownSeconds,
  countdownText,
  hexColor,
  kmh,
  textOn,
} from '../../../src/ui/format';

const clock = (f: number) => clockText(clockMinutes(f));

describe('clock', () => {
  it('shows the 12-minute day as a 24-hour clock', () => {
    expect(clock(0)).toBe('00:00');
    expect(clock(0.3)).toBe('07:10'); // a new game starts at 07:12, shown in 5-minute steps
    expect(clock(0.5)).toBe('12:00');
    expect(clock(0.75)).toBe('18:00');
    expect(clock(0.999999)).toBe('23:55');
    expect(clock(1)).toBe('00:00');
  });

  it('ticks in 5-minute steps of game time', () => {
    const seen = new Set<string>();
    let changes = 0;
    let last = '';
    for (let t = 0; t < DAY_TICKS; t++) {
      const s = clock(dayFrac(t));
      seen.add(s);
      if (s !== last) changes++;
      last = s;
      expect(Number(s.slice(3)) % 5).toBe(0);
    }
    expect(seen.size).toBe(288);
    expect(changes).toBe(288);
    // 5 game minutes = 1/288 of the day = 150 ticks = 2.5 s of play.
    expect(clock(dayFrac(149))).toBe('00:00');
    expect(clock(dayFrac(150))).toBe('00:05');
  });
});

describe('countdown', () => {
  it('formats m:ss of real time, rounding up so 0:00 means arrived', () => {
    expect(countdownText(countdownSeconds(0))).toBe('0:00');
    expect(countdownText(countdownSeconds(1))).toBe('0:01');
    expect(countdownText(countdownSeconds(60))).toBe('0:01');
    expect(countdownText(countdownSeconds(61))).toBe('0:02');
    expect(countdownText(countdownSeconds(59 * 60))).toBe('0:59');
    expect(countdownText(countdownSeconds(60 * 60))).toBe('1:00');
    expect(countdownText(countdownSeconds(60 * 125))).toBe('2:05');
    expect(countdownText(countdownSeconds(Infinity))).toBe('--:--');
  });
});

describe('board text and colour', () => {
  it('upper-cases keeping accents, converts speeds and colours', () => {
    expect(boardText('Tranvía 5')).toBe('TRANVÍA 5');
    expect(kmh(10)).toBe(36);
    expect(kmh(-2.5)).toBe(9);
    expect(hexColor(0xffae1a)).toBe('#ffae1a');
    expect(hexColor(0x00a99d)).toBe('#00a99d');
    expect(textOn(0xffae1a)).toBe('#1B1A2E');
    expect(textOn(0x1f3fbf)).toBe('#F3EBDD');
  });
});
