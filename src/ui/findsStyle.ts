/**
 * Styles for the finds: the tile counter, the spot stamp, the postcard and unlock tickets, and the
 * album tab (wardrobe, tiles, spots, postcards, bests), in the print look of style.ts and
 * ledgerStyle.ts. Injected once, reference counted.
 */

const CSS = `
/* Tile counter: a short stub, one line */
.sk-ticket.sk-ftile{align-self:flex-start;padding:4px 10px 5px 28px;min-width:0}
.sk-ticket.sk-ftile::before{left:21px}
.sk-ftile .sk-op{font-size:14px;color:var(--sk-cobalt);text-shadow:1px 1px 0 rgba(255,46,136,.55);font-variant-numeric:tabular-nums}
/* A spot: a rubber stamp across the ticket */
.sk-ticket[data-kind="spot"]{min-height:66px}
.sk-fstamp{position:absolute;left:40px;right:12px;top:30px;padding:2px 6px;border:3px double var(--sk-pink);border-radius:4px;
  color:var(--sk-pink);font:700 15px/1.15 'Arial Narrow',Arial,sans-serif;letter-spacing:.08em;text-align:center;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transform:rotate(-4deg);opacity:.9;mix-blend-mode:multiply}
/* A postcard: a perforated stamp in the corner */
.sk-fpost{position:absolute;right:10px;top:8px;width:24px;height:28px;background:var(--sk-mango);
  box-shadow:inset 0 0 0 3px var(--sk-paper),inset 0 0 0 4px var(--sk-cobalt);transform:rotate(6deg)}
.sk-ticket[data-kind="postcard"] .sk-serial{margin-right:30px}
/* An unlock: the swatch of what came */
.sk-fswatch{flex:none;width:30px;height:14px;border-radius:7px;box-shadow:0 0 0 1.5px var(--sk-ink)}

/* Album */
.sk-asum{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;color:var(--sk-ink)}
.sk-asum b{font-size:18px;font-variant-numeric:tabular-nums;margin-right:12px}
.sk-asec{display:flex;flex-direction:column;gap:5px}
.sk-ahead{display:flex;justify-content:space-between;font-weight:700;font-size:13px;letter-spacing:.18em;color:var(--sk-cobalt);
  border-bottom:2px dotted rgba(31,63,191,.4);padding-bottom:3px}
.sk-aside{color:var(--sk-pink);font-variant-numeric:tabular-nums}
.sk-anone{font-size:12px;font-weight:700;letter-spacing:.08em;color:rgba(27,26,46,.5)}
.sk-awrow{display:flex;gap:5px;overflow-x:auto;padding-bottom:2px;touch-action:pan-x pan-y}
.sk-awear{flex:none;pointer-events:auto;width:84px;min-height:74px;padding:6px 5px;border:0;border-radius:3px;cursor:pointer;
  display:flex;flex-direction:column;align-items:center;gap:4px;background:var(--sk-ink);color:var(--sk-paper);
  font:700 11px/1.1 'Arial Narrow',Arial,sans-serif;letter-spacing:.05em;text-transform:uppercase;
  box-shadow:2px 2px 0 rgba(31,63,191,.45)}
.sk-awear.sk-sel{box-shadow:inset 0 0 0 2px var(--sk-mango),2px 2px 0 rgba(31,63,191,.45)}
.sk-awear.sk-locked{opacity:.5;cursor:default}
.sk-awear.sk-locked .sk-aswatch{filter:grayscale(1) brightness(.7)}
.sk-aswatch{display:block;width:60px;height:18px;border-radius:9px;box-shadow:0 0 0 1.5px var(--sk-paper)}
.sk-aswatch.sk-akit{width:26px;height:26px;border-radius:13px 13px 4px 4px}
.sk-awname{text-align:center;min-height:2.2em}
.sk-awsub{font-size:9px;letter-spacing:.1em;color:var(--sk-mango);text-align:center}
.sk-awear.sk-locked .sk-awsub{color:#C9C1B3}
.sk-arow{display:flex;align-items:center;flex-wrap:wrap;gap:5px 8px;padding:6px 8px;border-radius:3px;background:var(--sk-ink);color:var(--sk-paper);
  font-weight:700;font-size:12px;letter-spacing:.06em}
.sk-aname{flex:1 0 100%;color:var(--sk-mango);font-size:13px}
.sk-atier{display:inline-flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums}
.sk-atier i{width:12px;height:12px;background:var(--sk-paper);box-shadow:inset 0 0 0 3px var(--sk-tier)}
.sk-asil{display:inline-flex;gap:.35em;vertical-align:middle}
.sk-asil i{display:block;height:.85em;border-radius:2px;background:#4A4870}
.sk-astamp{flex:none;width:30px;height:30px;border-radius:50%;box-shadow:inset 0 0 0 2px #4A4870}
.sk-astamp.sk-on{box-shadow:inset 0 0 0 3px var(--sk-pink);background:radial-gradient(circle,var(--sk-pink) 0 30%,transparent 32%)}
.sk-acards{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:6px}
.sk-acard{position:relative;min-height:62px;padding:7px 8px;border-radius:2px;background:#D4C8B2;color:rgba(27,26,46,.5);
  display:flex;flex-direction:column;justify-content:space-between;font-weight:700;font-size:12px;letter-spacing:.05em}
.sk-acard.sk-on{background:var(--sk-paper);color:var(--sk-ink);box-shadow:2px 2px 0 rgba(31,63,191,.45)}
.sk-acard.sk-on::after{content:'';position:absolute;right:6px;top:6px;width:16px;height:19px;background:var(--sk-mango);
  box-shadow:inset 0 0 0 2px var(--sk-paper),inset 0 0 0 3px var(--sk-cobalt)}
.sk-acardname{padding-right:20px}
.sk-acardsub{font-size:10px;letter-spacing:.14em;color:var(--sk-cobalt)}
.sk-acard:not(.sk-on) .sk-acardsub{color:rgba(27,26,46,.4)}
.sk-abest{display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:baseline;color:var(--sk-ink)}
.sk-abest b{font-size:16px;font-variant-numeric:tabular-nums}
.sk-abest b.sk-cnone{color:rgba(27,26,46,.45)}
.sk-mapfinds{color:var(--sk-cobalt);margin-left:10px}
`;

let refs = 0;
let styleEl: HTMLStyleElement | null = null;

export function injectFindsStyle(): () => void {
  if (refs++ === 0) {
    styleEl = document.createElement('style');
    styleEl.dataset.sk = 'finds';
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--refs === 0 && styleEl) {
      styleEl.remove();
      styleEl = null;
    }
  };
}
