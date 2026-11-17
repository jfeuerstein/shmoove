/**
 * Chalk-line HUD pieces: the REC tag while recording, the race countdown in big split-flap cells
 * (3, 2, 1, GO on twos), the split timer (player time and the gap to the ghost: ahead in mango,
 * behind in pink) and the result ticket when a race ends.
 */
import { chalkPath, type ChalkLine } from '../sim/game/chalk';
import type { Game, GameEvent } from '../sim/game/game';
import { chalkClock, chalkGap, chalkTime, ghostTicksAt, nearestPathIndex } from './chalkFormat';
import { ClassSlot, TextSlot, el } from './dom';
import { FlapRow } from './flap';
import type { Twos } from './twos';

/** How long GO stays up, and the result ticket, seconds. */
const GO_SHOW = 0.75;
const RESULT_SHOW = 8;

export class ChalkHud {
  readonly el: HTMLElement;
  /** Seconds left shown by the countdown (0 when not counting down). */
  countdown = 0;
  /** The result ticket on screen. */
  result: '' | 'won' | 'lost' = '';
  private readonly rec: HTMLElement;
  private readonly recOn: ClassSlot;
  private readonly recTime: TextSlot;
  private readonly count: HTMLElement;
  private readonly countOn: ClassSlot;
  private readonly digit: FlapRow;
  private readonly go: FlapRow;
  private readonly split: HTMLElement;
  private readonly splitOn: ClassSlot;
  private readonly time: FlapRow;
  private readonly gap: TextSlot;
  private readonly gapAhead: ClassSlot;
  private readonly gapBehind: ClassSlot;
  private readonly resultEl: HTMLElement;
  private goLeft = 0;
  private resultLeft = 0;
  private pathId = '';
  private path: Float32Array = new Float32Array(0);
  private pathIdx = 0;
  private line: ChalkLine | null = null;

  constructor(
    private readonly game: Game,
    private readonly twos: Twos,
  ) {
    this.el = el('div', 'sk-chalkhud');
    this.rec = el('div', 'sk-rec');
    const recTime = el('span', 'sk-rectime');
    this.rec.append(el('i', 'sk-recdot'), el('span', 'sk-reclabel', 'REC'), recTime);
    this.recOn = new ClassSlot(this.rec, 'sk-on');
    this.recTime = new TextSlot(recTime);

    this.count = el('div', 'sk-count sk-panel');
    this.digit = new FlapRow(twos, 1);
    this.go = new FlapRow(twos, 2, 'left', 'sk-pinkflap');
    this.count.append(this.digit.el, this.go.el);
    this.countOn = new ClassSlot(this.count, 'sk-on');

    this.split = el('div', 'sk-split sk-panel');
    this.time = new FlapRow(twos, 6, 'right');
    const gap = el('span', 'sk-gap');
    this.split.append(el('span', 'sk-splitlabel', 'YOU'), this.time.el, el('span', 'sk-splitlabel', 'GAP'), gap);
    this.splitOn = new ClassSlot(this.split, 'sk-on');
    this.gap = new TextSlot(gap);
    this.gapAhead = new ClassSlot(gap, 'sk-ahead');
    this.gapBehind = new ClassSlot(gap, 'sk-behind');

    this.resultEl = el('div', 'sk-cresult');
    this.el.append(this.rec, this.count, this.split, this.resultEl);
  }

  onEvent(e: GameEvent): void {
    switch (e.type) {
      case 'chalkCountdown':
        this.countdown = e.secondsLeft;
        this.hideResult();
        this.digit.set(String(e.secondsLeft));
        this.digit.el.style.display = '';
        this.go.el.style.display = 'none';
        this.countOn.set(true);
        this.twos.play(this.count, 'sk-pop1', 'sk-pop2');
        break;
      case 'chalkGo':
        this.countdown = 0;
        this.goLeft = GO_SHOW;
        this.go.set('GO');
        this.digit.el.style.display = 'none';
        this.go.el.style.display = '';
        this.twos.play(this.count, 'sk-pop1', 'sk-pop2');
        break;
      case 'chalkFinish':
        this.showResult(e);
        this.countdown = 0;
        break;
      case 'chalkAbort':
        this.countdown = 0;
        this.goLeft = 0;
        break;
      case 'chalkRecordStart':
        this.hideResult();
        break;
      default:
        break;
    }
  }

  update(dt: number): void {
    const st = this.game.chalk;
    this.recOn.set(st.mode === 'recording');
    if (st.mode === 'recording') this.recTime.set(chalkClock(st.elapsedTicks));

    if (this.goLeft > 0) this.goLeft -= dt;
    if (st.mode !== 'countdown') this.countdown = 0;
    this.countOn.set(st.mode === 'countdown' || this.goLeft > 0);

    const racing = st.mode === 'racing' || st.mode === 'countdown';
    this.splitOn.set(racing);
    if (racing && st.activeId !== null) {
      if (st.activeId !== this.pathId) {
        this.line = st.lines.find((l) => l.id === st.activeId) ?? null;
        this.path = this.line ? chalkPath(this.game.sim.world, this.line) : new Float32Array(0);
        this.pathId = st.activeId;
        this.pathIdx = 0;
      }
      const t = st.mode === 'racing' ? st.elapsedTicks : 0;
      this.time.set(chalkTime(t));
      if (st.mode === 'racing' && this.line) {
        const p = this.game.sim.player;
        this.pathIdx = nearestPathIndex(this.path, p.x, p.z, this.pathIdx);
        const g = t - ghostTicksAt(this.pathIdx, this.line.ticks);
        this.gap.set(chalkGap(g));
        const tenths = Math.round((Math.abs(g) * 10) / 60);
        this.gapAhead.set(g < 0 && tenths > 0);
        this.gapBehind.set(g > 0 && tenths > 0);
      } else {
        this.gap.set('0.0');
        this.gapAhead.set(false);
        this.gapBehind.set(false);
      }
    } else if (!racing) this.pathId = '';

    if (this.resultLeft > 0) {
      this.resultLeft -= dt;
      if (this.resultLeft <= 0) this.hideResult();
    }
  }

  private showResult(e: Extract<GameEvent, { type: 'chalkFinish' }>): void {
    const line = this.game.chalk.lines.find((l) => l.id === e.id);
    this.result = e.won ? 'won' : 'lost';
    this.resultLeft = RESULT_SHOW;
    const r = this.resultEl;
    r.textContent = '';
    r.className = 'sk-cresult sk-on';
    const t = el('div', 'sk-ticket sk-big sk-cresticket');
    const head = el('div', 'sk-thead');
    head.append(el('span', 'sk-op', e.won ? 'WON' : 'LOST'), el('span', 'sk-serial', 'Nº ' + e.id.slice(0, 6).toUpperCase()));
    t.appendChild(head);
    if (line) t.appendChild(el('div', 'sk-tbody', line.name.toLocaleUpperCase('es')));
    const rows = el('div', 'sk-cresrows');
    rows.append(
      el('span', 'sk-cfact', 'You'),
      el('b', '', e.ticks > 0 ? chalkTime(e.ticks) : 'DNF'),
      el('span', 'sk-cfact', 'Ghost'),
      el('b', '', chalkTime(e.ghostTicks)),
    );
    t.appendChild(rows);
    if (e.best) t.appendChild(el('span', 'sk-stamp sk-cbest', 'BEST'));
    r.appendChild(t);
    this.twos.play(t, 'sk-in1', 'sk-in2');
  }

  private hideResult(): void {
    this.result = '';
    this.resultLeft = 0;
    this.resultEl.className = 'sk-cresult';
    this.resultEl.textContent = '';
  }
}
