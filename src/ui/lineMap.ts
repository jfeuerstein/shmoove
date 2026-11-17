/**
 * The line map screen: a schematic of the network as inline SVG (paths projected to plan with
 * uphill at the top, simplified and fitted), district bands, each discovered line in its livery
 * colour (un-inked segments thin and dashed, inked ones thick and printed off-register), stops, a
 * "you are here" marker, a header with overall progress and a tappable legend. The legend carries a
 * conductor's punch per line and the title strip the number of secrets found.
 */
import type { Game } from '../sim/game/game';
import { inkedCount, lineSegments, mapFraction, type Segment } from '../sim/game/progress';
import { SECRET_IDS } from '../sim/game/secrets';
import { pathAt, type CompiledLine } from '../sim/lines';
import { DISTRICT_NAMES } from '../sim/world';
import { el, makeBadge } from './dom';
import { FlapRow } from './flap';
import { boardText, hexColor } from './format';
import type { Twos } from './twos';
import { fitProjection, pathData, polyBounds, project, simplify, subPath, type Poly } from './mapGeom';

/** Simplification tolerance, metres. */
export const MAP_TOLERANCE = 3;
const MARGIN = 26;
/** How far the schematic may stretch a long thin network across the screen. */
const MAX_STRETCH = 3;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** A conductor's cap and ticket punch, for the legend. */
const CONDUCTOR_MARK =
  '<svg viewBox="0 0 14 14" aria-hidden="true">' +
  '<path d="M2 7 Q7 1.5 12 7 Z" fill="#F3EBDD"/><rect x="1.5" y="7" width="11" height="2" rx="1" fill="#F3EBDD"/>' +
  '<circle cx="7" cy="11.6" r="1.6" fill="#F3EBDD"/></svg>';

interface LineGeom {
  line: CompiledLine;
  segs: Segment[];
  /** Simplified plan polyline per segment. */
  polys: Poly[];
  /** Plan position of every stop. */
  stops: Array<[number, number]>;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class LineMap {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly pct: FlapRow;
  private readonly count: FlapRow;
  private readonly geoms: LineGeom[];
  private selected = -1;
  /** Lines drawn and the progress percentage on the last render. */
  drawn = 0;
  percent = 0;
  /** Secrets found, as shown on the last render. */
  secrets = 0;

  constructor(
    private readonly game: Game,
    twos: Twos,
    onClose: () => void,
    private readonly onTap: () => void,
  ) {
    this.pct = new FlapRow(twos, 4, 'right');
    this.count = new FlapRow(twos, 9);
    this.el = el('div', 'sk-map');
    const head = el('div', 'sk-maphead');
    const close = el('button', 'sk-close', 'Close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close the line map');
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      onClose();
    });
    head.append(this.pct.el, this.count.el, close);
    this.body = el('div', 'sk-mapbody');
    this.legend = el('div', 'sk-legend');
    this.el.append(head, this.body, this.legend);
    this.geoms = game.sim.world.lines.map((line) => {
      const segs = lineSegments(line);
      const p = { x: 0, y: 0, z: 0, hx: 0, hz: 1 };
      return {
        line,
        segs,
        polys: segs.map((g) => simplify(subPath(line, g.s0, g.s1), MAP_TOLERANCE)),
        stops: line.allStops.map((st): [number, number] => {
          pathAt(line, st.s, p);
          return [p.x, p.z];
        }),
      };
    });
  }

  /** Rebuild the screen from the current progress (called when it opens). */
  render(): void {
    const prog = this.game.progress;
    const lines = this.game.sim.world.lines;
    const shown = this.geoms.filter((g) => prog.lines[g.line.index].discovered);
    this.drawn = shown.length;
    if (this.selected >= 0 && !shown.some((g) => g.line.index === this.selected)) this.selected = -1;

    // Header: overall progress.
    const pct = Math.floor(mapFraction(prog, lines) * 100);
    let regular = 0;
    let done = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].secret === true) continue;
      regular++;
      if (prog.lines[i].complete) done++;
    }
    this.pct.set(`${pct}%`);
    this.count.set(`${done}/${regular} LINES`);
    this.percent = pct;

    // Legend first: it takes its height out of the map area, which the SVG then measures.
    this.drawLegend(shown);
    this.drawSvg(shown);
  }

  private drawSvg(shown: LineGeom[]): void {
    const rect = this.body.getBoundingClientRect();
    const w = Math.max(160, Math.round(rect.width));
    const h = Math.max(160, Math.round(rect.height));
    const sim = this.game.sim;
    const prog = this.game.progress;
    const all: Poly[] = [];
    for (const g of shown) for (const p of g.polys) all.push(p);
    if (all.length === 0) all.push([sim.player.x, sim.player.z]);
    const b = polyBounds(all);
    const pr = fitProjection(b, w, h, MARGIN, MAX_STRETCH);

    let svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">`;
    // District bands, faint stripes across the drawn area, uphill at the top.
    const zTop = pr.oy / pr.scale;
    const zBot = (pr.oy - h) / pr.scale;
    let k = 0;
    for (const band of sim.world.bands) {
      const z1 = Math.min(band.zMax, zTop);
      const z0 = Math.max(band.zMin, zBot);
      if (z1 <= z0) continue;
      const y0 = project(pr, 0, z1)[1];
      const y1 = project(pr, 0, z0)[1];
      svg += `<rect x="0" y="${y0.toFixed(1)}" width="${w}" height="${(y1 - y0).toFixed(1)}" fill="${k % 2 ? '#1F3FBF' : '#FFAE1A'}" opacity="${k % 2 ? 0.06 : 0.1}"/>`;
      svg += `<text x="10" y="${(y1 - 10).toFixed(1)}" font-size="12" font-weight="700" letter-spacing="2.5" fill="#1F3FBF" opacity="0.5">${escapeXml(boardText(DISTRICT_NAMES[band.district]))}</text>`;
      k++;
    }
    const sel = this.selected;
    for (const g of shown) {
      const li = g.line.index;
      const col = hexColor(g.line.livery.base);
      const dim = sel >= 0 && sel !== li;
      svg += `<g opacity="${dim ? 0.22 : 1}" data-line="${escapeXml(g.line.id)}">`;
      const inked = prog.lines[li].inked;
      for (let i = 0; i < g.polys.length; i++) {
        const d = pathData(pr, g.polys[i]);
        if (inked[i]) {
          svg +=
            `<path d="${d}" transform="translate(-1 0)" stroke="#FF2E88" stroke-opacity="0.75" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
            `<path d="${d}" transform="translate(1 1)" stroke="#1F3FBF" stroke-opacity="0.75" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
            `<path d="${d}" stroke="${col}" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round" data-ink="1"/>`;
        } else {
          svg += `<path d="${d}" stroke="${col}" stroke-opacity="0.35" stroke-width="2.5" stroke-dasharray="6 5" fill="none" stroke-linecap="round" stroke-linejoin="round" data-ink="0"/>`;
        }
      }
      for (let i = 0; i < g.stops.length; i++) {
        const [x, y] = project(pr, g.stops[i][0], g.stops[i][1]);
        svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="#F3EBDD" stroke="#1B1A2E" stroke-width="2.2"/>`;
      }
      svg += '</g>';
    }
    // Stop names of the highlighted line, on top of everything.
    if (sel >= 0) {
      const g = shown.find((q) => q.line.index === sel);
      if (g) {
        // Labels go on the outside of the line: right of its centre to the right, else left.
        let cx = 0;
        for (const st of g.stops) cx += project(pr, st[0], st[1])[0];
        cx /= Math.max(1, g.stops.length);
        for (let i = 0; i < g.stops.length; i++) {
          const [x, y] = project(pr, g.stops[i][0], g.stops[i][1]);
          const right = x >= cx - 1 ? x < w - 90 : x < 90;
          svg += `<text x="${(x + (right ? 9 : -9)).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}" font-size="12" font-weight="700" letter-spacing="1" fill="#1B1A2E" stroke="#F3EBDD" stroke-width="3" paint-order="stroke">${escapeXml(boardText(g.line.allStops[i].name))}</text>`;
        }
      }
    }
    // You are here.
    const [px, py] = project(pr, sim.player.x, sim.player.z);
    svg +=
      `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)})">` +
      `<circle r="12" fill="none" stroke="#FF2E88" stroke-width="2.5"/>` +
      `<circle r="5.5" fill="#FF2E88" stroke="#1B1A2E" stroke-width="1.5"/>` +
      `<text x="16" y="4" font-size="11" font-weight="700" letter-spacing="1.5" fill="#FF2E88" stroke="#F3EBDD" stroke-width="3" paint-order="stroke">YOU</text>` +
      `</g>`;
    svg += '</svg>';
    let secrets = 0;
    for (const id of SECRET_IDS) if (this.game.secrets.found[id] !== undefined) secrets++;
    this.secrets = secrets;
    this.body.innerHTML =
      svg + `<div class="sk-maptitle">SANTA RAMPA · LINES<span class="sk-mapsecrets">SECRETS ${secrets}/${SECRET_IDS.length}</span></div>`;
  }

  private drawLegend(shown: LineGeom[]): void {
    const prog = this.game.progress;
    this.legend.textContent = '';
    for (const g of shown) {
      const li = g.line.index;
      const row = el('button', 'sk-leg' + (li === this.selected ? ' sk-sel' : ''));
      row.type = 'button';
      row.dataset.line = g.line.id;
      const lp = prog.lines[li];
      const punch = el('span', 'sk-punch' + (lp.complete ? ' sk-done' : ''));
      const hasConductor = this.game.conductors.list.some((c) => c.line === g.line.id);
      const cond = el('span', 'sk-legcond' + (this.game.conductors.punched[g.line.id] ? ' sk-done' : ''));
      cond.innerHTML = CONDUCTOR_MARK;
      cond.setAttribute('aria-label', this.game.conductors.punched[g.line.id] ? 'Conductor punched' : 'Conductor not punched');
      if (!hasConductor) cond.style.visibility = 'hidden';
      row.append(
        makeBadge(g.line),
        el('span', 'sk-legname', boardText(g.line.name)),
        el('span', 'sk-legcount', `${inkedCount(prog, li)}/${lp.inked.length}`),
        cond,
        punch,
        el('span', 'sk-legstops', g.line.allStops.map((s) => boardText(s.name)).join(' · ')),
      );
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selected = this.selected === li ? -1 : li;
        this.onTap();
        this.render();
      });
      this.legend.appendChild(row);
    }
  }
}
