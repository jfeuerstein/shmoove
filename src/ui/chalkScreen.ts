/**
 * The chalk screen (pauses play, like the line map): saved lines as ticket stubs with RACE, SHARE,
 * RENAME and DELETE; DRAW and IMPORT at the foot. Sub-views: the share code block, the import
 * paste box (bad codes come back stamped VOID with the reason), the rename box and the name prompt
 * shown when a recording stops.
 *
 * It changes game state only through Game's chalk commands.
 */
import type { ChalkLine } from '../sim/game/chalk';
import { CHALK_MAX_LINES, encodeChalk } from '../sim/game/chalk';
import type { Game } from '../sim/game/game';
import { chalkClock, chalkTime } from './chalkFormat';
import { el } from './dom';
import { FlapRow } from './flap';
import { boardText } from './format';
import type { Twos } from './twos';

export type ChalkScreenView = 'list' | 'share' | 'import' | 'name' | 'rename';

export interface ChalkScreenHost {
  /** Close the whole screen. */
  close(): void;
  /** A button was tapped (tick sound). */
  tap(): void;
  /** Recording started from DRAW: the host closes the screen. */
  drew(): void;
  /** A race was started: the host closes the screen. */
  raced(): void;
  /** The name prompt finished: the host closes the screen. `stopped` if it just saved a recording. */
  named(stopped: boolean): void;
}

function button(cls: string, text: string, key: string, onTap: () => void): HTMLButtonElement {
  const b = el('button', 'sk-cbtn ' + cls, text);
  b.type = 'button';
  b.dataset.sk = key;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.disabled) return;
    onTap();
  });
  return b;
}

export class ChalkScreen {
  readonly el: HTMLElement;
  view: ChalkScreenView = 'list';
  /** The code in the share block, or ''. */
  code = '';
  /** The last import error, or ''. */
  error = '';
  private readonly title: FlapRow;
  private readonly count: FlapRow;
  private readonly body: HTMLElement;
  private readonly foot: HTMLElement;
  private readonly drawBtn: HTMLButtonElement;
  private readonly reason: HTMLElement;
  private shareId = '';
  private renameId = '';
  private confirmDelete = '';
  private nameDefault = '';
  private importDraft = '';
  /** The name prompt renames this already-saved line (a recording that hit the length limit). */
  private nameForId = '';

  constructor(
    private readonly game: Game,
    twos: Twos,
    private readonly host: ChalkScreenHost,
  ) {
    this.el = el('div', 'sk-chalk');
    const head = el('div', 'sk-maphead sk-chalkhead');
    this.title = new FlapRow(twos, 5);
    this.count = new FlapRow(twos, 5, 'right');
    const close = button('sk-close', 'Close', 'chalkClose', () => this.host.close());
    close.classList.remove('sk-cbtn');
    close.setAttribute('aria-label', 'Close the chalk lines');
    head.append(this.title.el, this.count.el, close);
    this.body = el('div', 'sk-chalkbody');
    this.foot = el('div', 'sk-chalkfoot');
    this.drawBtn = button('sk-cdraw', 'Draw', 'chalkDraw', () => this.draw());
    const imp = button('sk-cimport', 'Import', 'chalkImport', () => {
      this.host.tap();
      this.error = '';
      this.show('import');
    });
    this.reason = el('div', 'sk-creason');
    const row = el('div', 'sk-cfootrow');
    row.append(this.drawBtn, imp);
    this.foot.append(row, this.reason);
    this.el.append(head, this.body, this.foot);
  }

  /** Switch view and redraw. */
  show(view: ChalkScreenView): void {
    this.view = view;
    if (view !== 'share') this.code = '';
    if (view !== 'list') this.confirmDelete = '';
    this.render();
  }

  /** Open the name prompt for a recording being stopped (or a saved line to rename after a cap). */
  promptName(defaultName: string, forId = ''): void {
    this.nameDefault = defaultName;
    this.nameForId = forId;
    this.show('name');
  }

  /** Open the import box with `code` already pasted (a shared link). */
  prefillImport(code: string): void {
    this.importDraft = code;
    this.error = '';
    this.show('import');
  }

  render(): void {
    const lines = this.game.chalk.lines;
    this.title.set(this.view === 'name' ? 'SAVE' : 'CHALK');
    this.count.set(`${lines.length}/${CHALK_MAX_LINES}`);
    this.body.textContent = '';
    this.body.scrollTop = 0;
    const listy = this.view === 'list';
    this.foot.style.display = listy ? '' : 'none';
    switch (this.view) {
      case 'list':
        this.renderList(lines);
        break;
      case 'share':
        this.renderShare();
        break;
      case 'import':
        this.renderImport();
        break;
      case 'name':
        this.renderName();
        break;
      case 'rename':
        this.renderRename();
        break;
    }
    const why = this.game.chalkCannotRecord();
    this.drawBtn.disabled = why !== '';
    this.reason.textContent = why ? boardText(why) : '';
    this.reason.style.display = why ? '' : 'none';
  }

  /** Centres of the visible controls, for the e2e hook: `${key}X`, `${key}Y`. */
  centres(out: Record<string, string | number | boolean>): void {
    for (const node of this.el.querySelectorAll<HTMLElement>('[data-sk]')) {
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const k = node.dataset.sk ?? '';
      out[k + 'X'] = Math.round(r.left + r.width / 2);
      out[k + 'Y'] = Math.round(r.top + r.height / 2);
    }
  }

  // ------------------------------------------------------------------------------------------

  private draw(): void {
    const r = this.game.chalkStartRecording();
    this.host.tap();
    if (r.ok) this.host.drew();
    else this.render();
  }

  private renderList(lines: ChalkLine[]): void {
    if (lines.length === 0) {
      const empty = el('div', 'sk-cempty');
      empty.append(
        el('div', 'sk-cemptyhead', 'No chalk lines yet'),
        el('div', 'sk-cemptybody', 'Tap DRAW, skate a route, tap STOP. Then race your ghost, or share the code.'),
      );
      this.body.appendChild(empty);
      return;
    }
    lines.forEach((line, i) => this.body.appendChild(this.ticket(line, i)));
  }

  private ticket(line: ChalkLine, i: number): HTMLElement {
    const beaten = line.bestTicks > 0 && line.bestTicks <= line.ticks;
    const t = el('div', 'sk-ticket sk-cticket');
    t.dataset.line = line.id;
    const head = el('div', 'sk-thead');
    head.append(el('span', 'sk-op', boardText(line.name)), el('span', 'sk-serial', 'Nº ' + line.id.slice(0, 6).toUpperCase()));
    const facts = el('div', 'sk-cfacts');
    facts.append(
      el('span', 'sk-cfact', 'Length'),
      el('b', '', chalkClock(line.ticks)),
      el('span', 'sk-cfact', 'Best'),
      el('b', line.bestTicks > 0 ? '' : 'sk-cnone', line.bestTicks > 0 ? chalkTime(line.bestTicks) : '—'),
    );
    const acts = el('div', 'sk-cacts');
    const del = this.confirmDelete === line.id;
    acts.append(
      button('sk-crace', 'Race', `chalkRace${i}`, () => {
        this.host.tap();
        if (this.game.chalkStartRace(line.id).ok) this.host.raced();
        else this.render();
      }),
      button('', 'Share', `chalkShare${i}`, () => {
        this.host.tap();
        this.shareId = line.id;
        this.show('share');
      }),
      button('', 'Rename', `chalkRename${i}`, () => {
        this.host.tap();
        this.renameId = line.id;
        this.show('rename');
      }),
      button(del ? 'sk-csure' : '', del ? 'Sure?' : 'Delete', `chalkDelete${i}`, () => {
        this.host.tap();
        if (this.confirmDelete === line.id) {
          this.confirmDelete = '';
          this.game.chalkDelete(line.id);
        } else this.confirmDelete = line.id;
        this.render();
      }),
    );
    t.append(head, facts, acts);
    if (beaten) t.appendChild(el('span', 'sk-stamp sk-cpunch', 'WON'));
    return t;
  }

  private card(title: string): HTMLElement {
    const c = el('div', 'sk-ticket sk-ccard');
    const head = el('div', 'sk-thead');
    head.append(el('span', 'sk-op', boardText(title)));
    c.appendChild(head);
    this.body.appendChild(c);
    return c;
  }

  private backButton(): HTMLButtonElement {
    return button('', 'Back', 'chalkBack', () => {
      this.host.tap();
      this.show('list');
    });
  }

  private renderShare(): void {
    const line = this.game.chalk.lines.find((l) => l.id === this.shareId);
    if (!line) {
      this.show('list');
      return;
    }
    const c = this.card('Share ' + line.name);
    this.code = encodeChalk(line);
    const pre = el('pre', 'sk-ccode', this.code);
    pre.dataset.sk = 'chalkCode';
    const note = el('div', 'sk-cnote', `${this.code.length} characters · send it to a friend, they IMPORT it`);
    const copy = button('sk-crace', 'Copy', 'chalkCopy', () => {
      this.host.tap();
      const done = (ok: boolean): void => {
        copy.textContent = ok ? 'Copied' : 'Selected';
      };
      const select = (): void => {
        const sel = window.getSelection();
        if (sel) sel.selectAllChildren(pre);
        done(false);
      };
      try {
        const cb = navigator.clipboard;
        if (cb && typeof cb.writeText === 'function') cb.writeText(this.code).then(() => done(true), select);
        else select();
      } catch (_e) {
        select();
      }
    });
    const acts = el('div', 'sk-cacts');
    acts.append(copy, this.backButton());
    c.append(pre, note, acts);
  }

  private renderImport(): void {
    const c = this.card('Import a line');
    const box = el('textarea', 'sk-cpaste');
    box.dataset.sk = 'chalkPaste';
    box.placeholder = 'Paste a SK1- code';
    box.spellcheck = false;
    box.autocapitalize = 'off';
    box.setAttribute('autocomplete', 'off');
    box.value = this.importDraft;
    box.addEventListener('input', () => {
      this.importDraft = box.value;
    });
    const add = button('sk-crace', 'Add', 'chalkAdd', () => {
      this.host.tap();
      const r = this.game.chalkImport(box.value);
      if (r.ok) {
        this.error = '';
        this.importDraft = '';
        this.show('list');
      } else {
        this.error = r.reason;
        this.render();
      }
    });
    const acts = el('div', 'sk-cacts');
    acts.append(add, this.backButton());
    c.append(box, acts);
    if (this.error) {
      const v = el('div', 'sk-cvoid');
      v.append(el('span', 'sk-cvoidstamp', 'VOID'), el('span', 'sk-cvoidwhy', boardText(this.error)));
      c.appendChild(v);
    }
  }

  private nameBox(value: string, key: string): HTMLInputElement {
    const input = el('input', 'sk-cname');
    input.type = 'text';
    input.maxLength = 24;
    input.value = value;
    input.dataset.sk = key;
    input.spellcheck = false;
    input.setAttribute('autocomplete', 'off');
    return input;
  }

  private renderName(): void {
    const renaming = this.nameForId !== '';
    const c = this.card(renaming ? 'Line saved: name it' : 'Name this line');
    const ticks = renaming
      ? (this.game.chalk.lines.find((l) => l.id === this.nameForId)?.ticks ?? 0)
      : this.game.chalk.elapsedTicks;
    c.appendChild(el('div', 'sk-cnote', `Length ${chalkClock(ticks)}`));
    const input = this.nameBox(this.nameDefault, 'chalkName');
    const save = button('sk-crace', 'Save', 'chalkSave', () => {
      this.host.tap();
      const name = input.value.trim() === '' ? this.nameDefault : input.value;
      let stopped = false;
      if (renaming) this.game.chalkRename(this.nameForId, name);
      else stopped = this.game.chalkStopRecording(name).ok;
      this.nameForId = '';
      this.host.named(stopped);
    });
    const discard = button('', renaming ? 'Keep' : 'Discard', 'chalkDiscard', () => {
      this.host.tap();
      if (!renaming) this.game.chalkCancel();
      this.nameForId = '';
      this.host.named(false);
    });
    const acts = el('div', 'sk-cacts');
    acts.append(save, discard);
    c.append(input, acts);
  }

  private renderRename(): void {
    const line = this.game.chalk.lines.find((l) => l.id === this.renameId);
    if (!line) {
      this.show('list');
      return;
    }
    const c = this.card('Rename');
    const input = this.nameBox(line.name, 'chalkName');
    const ok = button('sk-crace', 'OK', 'chalkSave', () => {
      this.host.tap();
      this.game.chalkRename(line.id, input.value);
      this.show('list');
    });
    const acts = el('div', 'sk-cacts');
    acts.append(ok, this.backButton());
    c.append(input, acts);
  }
}
