/**
 * The ledger (pauses play, like the line map): three tabs as destination-board rows. ERRANDS lists
 * every errand as a ticket stub (title, the giver's district, best time or a dash, stamped DONE
 * once delivered; undone ones say where the giver stands, and when). CONDUCTORS lists the 13
 * conductors with line badges, their task and a punch hole. SECRETS shows four rows: found ones
 * by name, the rest as ????? with a hint that does not spoil. The header carries the totals.
 *
 * It changes game state only through Game's commands (abandoning the errand in progress).
 */
import type { Game } from '../sim/game/game';
import { SECRET_IDS } from '../sim/game/secrets';
import { DISTRICT_NAMES } from '../sim/world';
import { el, makeBadge } from './dom';
import { SECRET_INFO, conductorStop, giverText, hoursText, taskText, ticksClock } from './errandFormat';
import { FlapRow } from './flap';
import { boardText } from './format';
import type { Twos } from './twos';

export type LedgerTab = 'errands' | 'conductors' | 'secrets';
const TABS: readonly LedgerTab[] = ['errands', 'conductors', 'secrets'];
const TAB_KEY: Record<LedgerTab, string> = { errands: 'ledgerTabErrands', conductors: 'ledgerTabConductors', secrets: 'ledgerTabSecrets' };

export interface LedgerHost {
  close(): void;
  tap(): void;
}

function button(cls: string, text: string, key: string, onTap: () => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.dataset.sk = key;
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onTap();
  });
  return b;
}

export class LedgerScreen {
  readonly el: HTMLElement;
  tab: LedgerTab = 'errands';
  private readonly total: FlapRow;
  private readonly word: FlapRow;
  private readonly tabEls: Record<LedgerTab, HTMLButtonElement>;
  private readonly tabCounts: Record<LedgerTab, FlapRow>;
  private readonly body: HTMLElement;

  constructor(
    private readonly game: Game,
    twos: Twos,
    private readonly host: LedgerHost,
  ) {
    this.el = el('div', 'sk-ledger');
    const head = el('div', 'sk-maphead sk-ledgerhead');
    this.word = new FlapRow(twos, 6);
    this.total = new FlapRow(twos, 4, 'right');
    const close = button('sk-close', 'Close', 'ledgerClose', () => this.host.close());
    close.setAttribute('aria-label', 'Close the ledger');
    head.append(this.word.el, this.total.el, close);

    const tabs = el('div', 'sk-ltabs');
    const mk = (t: LedgerTab, label: string): [HTMLButtonElement, FlapRow] => {
      const count = new FlapRow(twos, 5, 'right');
      const b = button('sk-ltab sk-panel', '', TAB_KEY[t], () => {
        if (this.tab === t) return;
        this.host.tap();
        this.show(t);
      });
      const name = new FlapRow(twos, 10);
      name.set(label);
      b.append(name.el, count.el);
      tabs.appendChild(b);
      return [b, count];
    };
    const [e, ec] = mk('errands', 'ERRANDS');
    const [c, cc] = mk('conductors', 'CONDUCTORS');
    const [s, sc] = mk('secrets', 'SECRETS');
    this.tabEls = { errands: e, conductors: c, secrets: s };
    this.tabCounts = { errands: ec, conductors: cc, secrets: sc };
    this.body = el('div', 'sk-ledgerbody');
    this.el.append(head, tabs, this.body);
  }

  show(tab: LedgerTab): void {
    this.tab = tab;
    this.render();
  }

  /** Centres of the visible controls, for the e2e hook. */
  centres(out: Record<string, string | number | boolean>): void {
    for (const node of this.el.querySelectorAll<HTMLElement>('[data-sk]')) {
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const k = node.dataset.sk ?? '';
      out[k + 'X'] = Math.round(r.left + r.width / 2);
      out[k + 'Y'] = Math.round(r.top + r.height / 2);
    }
  }

  /** Done / total for each tab. */
  counts(): Record<LedgerTab, [number, number]> {
    const g = this.game;
    const errands = g.errands.list;
    let ed = 0;
    for (const d of errands) if (g.errands.done[d.id]) ed++;
    let cp = 0;
    for (const c of g.conductors.list) if (g.conductors.punched[c.line]) cp++;
    let sf = 0;
    for (const id of SECRET_IDS) if (g.secrets.found[id] !== undefined) sf++;
    return { errands: [ed, errands.length], conductors: [cp, g.conductors.list.length], secrets: [sf, SECRET_IDS.length] };
  }

  render(): void {
    const n = this.counts();
    let done = 0;
    let all = 0;
    for (const t of TABS) {
      done += n[t][0];
      all += n[t][1];
      this.tabCounts[t].set(`${n[t][0]}/${n[t][1]}`);
      this.tabEls[t].classList.toggle('sk-sel', t === this.tab);
      this.tabEls[t].setAttribute('aria-pressed', String(t === this.tab));
    }
    this.word.set('LEDGER');
    this.total.set(`${all > 0 ? Math.floor((done / all) * 100) : 0}%`);
    this.body.textContent = '';
    this.body.scrollTop = 0;
    if (this.tab === 'errands') this.renderErrands();
    else if (this.tab === 'conductors') this.renderConductors();
    else this.renderSecrets();
  }

  // ------------------------------------------------------------------------------------------

  private renderErrands(): void {
    const g = this.game;
    const w = g.sim.world;
    const list = el('div', 'sk-clist');
    const active = g.errands.active;
    for (const d of g.errands.list) {
      const rec = g.errands.done[d.id];
      const t = el('div', 'sk-ticket sk-lticket' + (rec ? ' sk-ldone' : ''));
      t.dataset.errand = d.id;
      const head = el('div', 'sk-thead');
      head.append(el('span', 'sk-op', boardText(d.title)), el('span', 'sk-serial', boardText(DISTRICT_NAMES[d.district])));
      const facts = el('div', 'sk-cfacts');
      facts.append(
        el('span', 'sk-cfact', 'Best'),
        el('b', rec ? '' : 'sk-cnone', rec ? ticksClock(rec.bestTicks) : '—'),
        el('span', 'sk-cfact', 'Limit'),
        el('b', '', ticksClock(d.limitTicks)),
      );
      t.append(head, facts);
      if (active && active.id === d.id) {
        const row = el('div', 'sk-lnow');
        row.append(
          el('span', 'sk-lnowtxt', `ON NOW · ${ticksClock(active.ticksLeft)} LEFT`),
          button('sk-cbtn sk-csure', 'Give up', 'ledgerAbandon', () => {
            this.host.tap();
            g.errandAbandon();
            this.render();
          }),
        );
        t.appendChild(row);
      } else if (!rec) {
        const h = hoursText(d);
        t.appendChild(el('div', 'sk-lwhere', `Find them at ${giverText(w, d)}${h ? ' · ' + h : ''}`));
      }
      if (rec) t.appendChild(el('span', 'sk-stamp sk-lstamp', 'DONE'));
      list.appendChild(t);
    }
    this.body.appendChild(list);
  }

  private renderConductors(): void {
    const g = this.game;
    const w = g.sim.world;
    const list = el('div', 'sk-lrows');
    for (const c of g.conductors.list) {
      const L = w.lines.find((l) => l.id === c.line);
      if (!L) continue;
      const punched = g.conductors.punched[c.line] === true;
      const row = el('div', 'sk-lrow' + (punched ? ' sk-lpunched' : ''));
      row.dataset.line = c.line;
      const txt = el('div', 'sk-lrowtxt');
      txt.append(el('div', 'sk-lrowtask', taskText(w, c)), el('div', 'sk-lrowsub', `${boardText(L.name)} · AT ${conductorStop(w, c)}`));
      row.append(makeBadge(L), txt, el('span', 'sk-punch' + (punched ? ' sk-done' : '')));
      list.appendChild(row);
    }
    this.body.appendChild(list);
  }

  private renderSecrets(): void {
    const g = this.game;
    const list = el('div', 'sk-lrows');
    for (const id of SECRET_IDS) {
      const found = g.secrets.found[id] !== undefined;
      const info = SECRET_INFO[id];
      const row = el('div', 'sk-lrow sk-lsecret' + (found ? ' sk-lpunched' : ''));
      row.dataset.secret = id;
      const txt = el('div', 'sk-lrowtxt');
      txt.append(el('div', 'sk-lrowtask', found ? boardText(info.name) : '?????'), el('div', 'sk-lrowsub', found ? 'FOUND' : boardText(info.hint)));
      row.append(el('span', 'sk-lstar' + (found ? ' sk-on' : ''), found ? '' : '?'), txt, el('span', 'sk-punch' + (found ? ' sk-done' : '')));
      list.appendChild(row);
    }
    this.body.appendChild(list);
  }
}
