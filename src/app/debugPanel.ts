/**
 * The feel panel (`?debug`): every FEEL constant as a live slider, grouped, with a readout of the
 * skater's state. Tuning here changes the running sim; "Copy" puts the changed values on the
 * clipboard as JSON to paste into src/sim/constants.ts.
 */
import { FEEL, FEEL_DEFS, resetFeel, type FeelKey } from '../sim/constants';
import type { Sim } from '../sim/sim';
import { MODE_NAMES } from '../sim/types';

export interface DebugPanel {
  /** Refresh the readout. Cheap; call once per frame. */
  update(sim: Sim, info: { drawCalls: number; triangles: number; workMs: number }): void;
  /** Number of constant rows (for the e2e check that nothing is missing). */
  rows: number;
}

const CSS = `
.feel{position:absolute;top:env(safe-area-inset-top,0);right:0;max-height:100%;width:min(86vw,330px);display:flex;flex-direction:column;
  font:11px/1.25 ui-monospace,Menlo,Consolas,monospace;color:#FFAE1A;pointer-events:auto;touch-action:pan-y}
.feel button{font:inherit;color:#1B1A2E;background:#FFAE1A;border:0;padding:5px 8px;margin:0 0 0 4px;letter-spacing:.06em}
.feel-bar{display:flex;justify-content:flex-end;padding:4px}
.feel-read{background:#1B1A2E;padding:4px 6px;white-space:pre;border-bottom:2px solid #FF2E88}
.feel-body{background:rgba(27,26,46,.93);overflow-y:auto;overscroll-behavior:contain;flex:1;min-height:0}
.feel-body.shut,.feel-read.shut{display:none}
.feel details{border-bottom:1px solid #3a3960}
.feel summary{padding:5px 6px;color:#F3EBDD;background:#1F3FBF;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.feel-row{display:grid;grid-template-columns:1fr 52px;gap:2px 6px;padding:3px 6px}
.feel-row label{grid-column:1/3;color:#F3EBDD;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.feel-row label.dirty{color:#FF2E88}
.feel-row input[type=range]{width:100%;margin:0;accent-color:#FFAE1A}
.feel-row output{text-align:right}
`;

export function createDebugPanel(root: HTMLElement): DebugPanel {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'feel';
  const bar = document.createElement('div');
  bar.className = 'feel-bar';
  const read = document.createElement('div');
  read.className = 'feel-read';
  const body = document.createElement('div');
  body.className = 'feel-body shut';
  panel.append(bar, read, body);

  const button = (text: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', fn);
    bar.appendChild(b);
    return b;
  };

  const refreshers: Array<() => void> = [];
  const groups = new Map<string, HTMLElement>();
  const keys = Object.keys(FEEL_DEFS) as FeelKey[];
  for (const key of keys) {
    const [def, min, max, group, note] = FEEL_DEFS[key];
    let box = groups.get(group);
    if (!box) {
      const d = document.createElement('details');
      const s = document.createElement('summary');
      s.textContent = group;
      d.appendChild(s);
      body.appendChild(d);
      groups.set(group, d);
      box = d;
    }
    const row = document.createElement('div');
    row.className = 'feel-row';
    row.dataset.feel = key;
    const label = document.createElement('label');
    label.textContent = key;
    label.title = note;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = String((max - min) / 400);
    const out = document.createElement('output');
    const show = (): void => {
      range.value = String(FEEL[key]);
      out.textContent = FEEL[key].toFixed(Math.abs(FEEL[key]) < 1 ? 3 : 2);
      label.classList.toggle('dirty', FEEL[key] !== def);
    };
    range.addEventListener('input', () => {
      FEEL[key] = Number(range.value);
      show();
    });
    label.addEventListener('dblclick', () => {
      FEEL[key] = def;
      show();
    });
    refreshers.push(show);
    show();
    row.append(label, range, out);
    box.appendChild(row);
  }

  button('FEEL', () => {
    body.classList.toggle('shut');
  });
  button('RESET', () => {
    resetFeel();
    for (const r of refreshers) r();
  });
  button('COPY', () => {
    const changed: Partial<Record<FeelKey, number>> = {};
    for (const k of keys) if (FEEL[k] !== FEEL_DEFS[k][0]) changed[k] = Number(FEEL[k].toFixed(4));
    const text = JSON.stringify(changed, null, 2);
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    console.info('FEEL changes', text);
  });
  button('HIDE', () => {
    read.classList.toggle('shut');
  });

  root.appendChild(panel);

  return {
    rows: keys.length,
    update(sim, info) {
      if (read.classList.contains('shut')) return;
      const p = sim.player;
      read.textContent =
        `${MODE_NAMES[p.mode].padEnd(6)} v ${p.speed.toFixed(1).padStart(5)}  chain ${p.chain}${p.chainAlive ? '*' : ' '}  steer ${p.steer.toFixed(2).padStart(5)}\n` +
        `x ${p.x.toFixed(1)} y ${p.y.toFixed(1)} z ${p.z.toFixed(1)}  day ${sim.dayFrac.toFixed(3)}\n` +
        `draws ${info.drawCalls}  tris ${info.triangles}  work ${info.workMs.toFixed(1)} ms`;
    },
  };
}
