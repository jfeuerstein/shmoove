/**
 * The app shell around play: title screen, pause card, settings, the map-complete celebration,
 * the rotate card and the "new version" ticket. It owns which of them is open and tells the UI
 * whether play is paused; everything app-level (saves, audio unlock, fullscreen, install, the
 * service worker) comes in through `ShellHost`, implemented in src/app/main.ts.
 */
import type { Game, GameEvent } from '../sim/game/game';
import { el } from './dom';
import { CompleteScreen } from './complete';
import { PauseCard, pauseButton } from './pause';
import { RotateCard, rotateShown } from './rotate';
import { SettingsScreen, SLIDER_STEPS, type SettingsValues } from './settings';
import { TitleScreen } from './title';
import { Shown, shellButton, writeCentres } from './titleKit';
import { injectShellStyle } from './titleStyle';
import type { Twos } from './twos';

export interface ShellHost {
  /** Open the title screen at launch. */
  readonly showTitle: boolean;
  /** e2e test switch: open the celebration at launch. */
  readonly celebrate: boolean;
  /** Pause when the page is hidden or loses focus. */
  readonly autoPause: boolean;
  readonly version: string;
  values(): SettingsValues;
  change(patch: Partial<SettingsValues>): void;
  hasSave(): boolean;
  /** PLAY / CONTINUE was tapped: unlock audio, ask for fullscreen. */
  play(): void;
  /** Wipe progress (keeping settings) and put the skater back at the start. */
  newGame(): void;
  /** Wipe everything, settings included. */
  resetSave(): void;
  /** Leaving play for the title: save now. */
  quitToTitle(): void;
  playSeconds(): number;
  installAvailable(): boolean;
  iosHint(): boolean;
  promptInstall(): void;
  updateReady(): boolean;
  applyUpdate(): void;
  /** Extra facts for the e2e hook (what storage holds, the last haptic). */
  testFacts(out: Record<string, string | number | boolean>): void;
}

/** What the shell needs from the rest of the UI. */
export interface ShellHooks {
  openMap(): void;
  openChalk(): void;
  /** Open the ledger (errands, conductors, secrets), if the UI has one. */
  openLedger?(): void;
  /** The line map, chalk screen or ledger is open. */
  busy(): boolean;
  mapPercent(): number;
  /** The game clock, HH:MM. */
  clock(): string;
  tap(): void;
  fanfare(): void;
}

type Screen = 'none' | 'title' | 'pause';

export class Shell {
  /** Elements to mount in the HUD, in order. */
  readonly els: HTMLElement[];
  private readonly title: TitleScreen;
  private readonly pause: PauseCard;
  private readonly settings: SettingsScreen;
  private readonly complete: CompleteScreen;
  private readonly rotate: RotateCard;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly update: HTMLElement;
  private readonly titleOn: Shown;
  private readonly pauseOn: Shown;
  private readonly settingsOn: Shown;
  private readonly completeOn: Shown;
  private readonly rotateOn: Shown;
  private readonly updateOn: Shown;
  private screen: Screen = 'none';
  private settingsOpen = false;
  private completeOpen = false;
  private rotating = false;
  private coarse = false;
  private releaseStyle: () => void;
  private readonly listeners: Array<[EventTarget, string, EventListener]> = [];
  private celebrateDue: boolean;
  private firstFrame = true;

  constructor(
    game: Game,
    twos: Twos,
    private readonly host: ShellHost,
    private readonly hooks: ShellHooks,
  ) {
    this.releaseStyle = injectShellStyle();
    const tap = (): void => hooks.tap();
    this.title = new TitleScreen(twos, {
      play: () => {
        host.play();
        this.setScreen('none');
      },
      newGame: () => {
        host.newGame();
        this.refreshTitle();
      },
      settings: () => this.setSettings(true),
      install: () => {
        host.promptInstall();
        this.refreshTitle();
      },
      tap,
    });
    this.pause = new PauseCard(twos, {
      resume: () => this.setScreen('none'),
      openMap: () => {
        this.setScreen('none');
        hooks.openMap();
      },
      openChalk: () => {
        this.setScreen('none');
        hooks.openChalk();
      },
      openLedger: hooks.openLedger
        ? () => {
            this.setScreen('none');
            hooks.openLedger?.();
          }
        : null,
      settings: () => this.setSettings(true),
      quit: () => {
        host.quitToTitle();
        this.setScreen('title');
      },
      tap,
    });
    this.settings = new SettingsScreen(twos, {
      values: () => host.values(),
      change: (p) => host.change(p),
      close: () => this.setSettings(false),
      resetSave: () => host.resetSave(),
      install: () => host.promptInstall(),
      installAvailable: () => host.installAvailable(),
      iosHint: () => host.iosHint(),
      version: host.version,
      tap,
    });
    this.complete = new CompleteScreen(game, twos, () => this.setComplete(false), tap);
    this.rotate = new RotateCard();
    this.pauseBtn = pauseButton(() => {
      hooks.tap();
      this.openPause();
    });

    this.update = el('div', 'sk-update');
    const ticket = el('div', 'sk-ticket sk-uticket');
    const head = el('div', 'sk-thead');
    head.append(el('span', 'sk-op', 'New timetable'), el('span', 'sk-serial', 'v+1'));
    const row = el('div', 'sk-urow');
    row.append(
      el('span', 'sk-tbody', 'A new version is ready'),
      shellButton('sk-crace sk-ureload', 'Reload', 'updateReload', () => {
        hooks.tap();
        host.applyUpdate();
      }),
    );
    ticket.append(head, row);
    this.update.appendChild(ticket);

    this.titleOn = new Shown(this.title.el);
    this.pauseOn = new Shown(this.pause.el);
    this.settingsOn = new Shown(this.settings.el);
    this.completeOn = new Shown(this.complete.el);
    this.rotateOn = new Shown(this.rotate.el);
    this.updateOn = new Shown(this.update);
    this.els = [this.pauseBtn, this.title.el, this.pause.el, this.complete.el, this.settings.el, this.update, this.rotate.el];

    // Rotate card: coarse pointer held sideways.
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
    this.coarse = mq ? mq.matches : false;
    this.listen(window, 'resize', () => this.checkRotate());
    this.listen(window, 'orientationchange', () => this.checkRotate());
    this.checkRotate();

    if (host.autoPause) {
      this.listen(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.autoPause();
      });
      this.listen(window, 'blur', () => this.autoPause());
    }
    this.listen(window, 'keydown', (e) => {
      const k = e as KeyboardEvent;
      if (k.repeat) return;
      const t = k.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (k.code === 'KeyP') {
        if (this.screen === 'pause' && !this.settingsOpen) this.setScreen('none');
        else this.openPause();
      } else if (k.code === 'Escape' && this.settingsOpen) this.setSettings(false);
    });

    this.celebrateDue = host.celebrate;
    if (host.showTitle) this.setScreen('title');
  }

  /** Play is paused by a shell screen. */
  get paused(): boolean {
    return this.screen !== 'none' || this.settingsOpen || this.completeOpen || this.rotating;
  }

  /** Called every UI frame. */
  frame(dt: number, events: readonly GameEvent[]): void {
    for (const e of events) if (e.type === 'mapComplete') this.setComplete(true);
    if (this.celebrateDue) {
      this.celebrateDue = false;
      this.setComplete(true);
    }
    const instant = this.host.values().reduced;
    if (this.screen === 'title') {
      // Mounted after the constructor opened the title: hide the HUD on the first frame.
      if (this.firstFrame) this.syncTitling();
      this.title.step(dt, instant);
    }
    this.firstFrame = false;
    if (this.completeOpen) this.complete.step(dt, instant);
    if (this.rotating) this.rotate.update(dt, instant);
    this.updateOn.set(this.host.updateReady());
  }

  testState(out: Record<string, string | number | boolean>): void {
    const v = this.host.values();
    out.titleOpen = this.screen === 'title';
    out.titleConfirm = this.screen === 'title' && this.title.confirmOpen;
    out.titlePlayLabel = this.title.playLabel;
    out.wordmark = this.title.wordmark;
    out.pauseOpen = this.screen === 'pause';
    out.settingsOpen = this.settingsOpen;
    out.completeOpen = this.completeOpen;
    out.completePunched = this.complete.punchedCount;
    out.rotateShown = this.rotating;
    out.installOffered = this.host.installAvailable();
    out.iosHint = this.host.iosHint();
    out.updateOffered = this.host.updateReady();
    out.setMusic = Math.round(v.music * SLIDER_STEPS);
    out.setSfx = Math.round(v.sfx * SLIDER_STEPS);
    out.setHaptics = v.haptics;
    out.setHints = v.hints;
    out.setReduced = v.reduced;
    out.setRiso = v.riso;
    out.playSeconds = Math.floor(this.host.playSeconds());
    this.host.testFacts(out);
    for (const root of this.els) if (root !== this.pauseBtn && root.classList.contains('sk-on')) writeCentres(root, out);
    // The corner button: -1 while hidden (a screen covers it or the map / chalk screen is open).
    const r = this.pauseBtn.getBoundingClientRect();
    const shown = r.width > 0 && this.screen === 'none' && !this.completeOpen && !this.settingsOpen;
    out.pauseBtnX = shown ? Math.round(r.left + r.width / 2) : -1;
    out.pauseBtnY = shown ? Math.round(r.top + r.height / 2) : -1;
  }

  dispose(): void {
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    this.listeners.length = 0;
    this.releaseStyle();
    this.releaseStyle = () => undefined;
  }

  // ------------------------------------------------------------------------------------------

  private listen(t: EventTarget, type: string, fn: EventListener): void {
    t.addEventListener(type, fn);
    this.listeners.push([t, type, fn]);
  }

  private openPause(): void {
    if (this.screen !== 'none' || this.completeOpen || this.hooks.busy()) return;
    this.setScreen('pause');
  }

  private autoPause(): void {
    if (this.screen === 'none' && !this.completeOpen && !this.hooks.busy()) this.setScreen('pause');
  }

  /** The HUD hides behind the title so the wordmark reads alone over the city. */
  private syncTitling(): void {
    const parent = this.title.el.parentElement;
    if (parent) parent.classList.toggle('sk-titling', this.screen === 'title');
  }

  private refreshTitle(): void {
    this.title.refresh({
      hasSave: this.host.hasSave(),
      playSeconds: this.host.playSeconds(),
      mapPercent: this.hooks.mapPercent(),
      installAvailable: this.host.installAvailable(),
      iosHint: this.host.iosHint(),
    });
  }

  private setScreen(s: Screen): void {
    this.screen = s;
    this.titleOn.set(s === 'title');
    this.syncTitling();
    this.pauseOn.set(s === 'pause');
    if (s === 'title') {
      this.title.open(
        {
          hasSave: this.host.hasSave(),
      playSeconds: this.host.playSeconds(),
          mapPercent: this.hooks.mapPercent(),
          installAvailable: this.host.installAvailable(),
          iosHint: this.host.iosHint(),
        },
        this.host.values().reduced,
      );
    } else if (s === 'pause') this.pause.open(this.hooks.clock());
  }

  private setSettings(open: boolean): void {
    this.settingsOpen = open;
    this.settingsOn.set(open);
    if (open) this.settings.open();
    else if (this.screen === 'title') this.refreshTitle();
  }

  private setComplete(open: boolean): void {
    if (open === this.completeOpen) return;
    this.completeOpen = open;
    this.completeOn.set(open);
    if (open) {
      this.complete.open(this.host.playSeconds(), this.host.values().reduced);
      this.hooks.fanfare();
    }
  }

  private checkRotate(): void {
    const on = rotateShown(window.innerWidth, window.innerHeight, this.coarse);
    if (on === this.rotating) return;
    this.rotating = on;
    this.rotateOn.set(on);
    if (on) this.rotate.reset();
  }
}
