/**
 * Styles for the chalk-line button, screen and HUD pieces, in the same print look as style.ts
 * (ink panels, paper ticket stubs, mango and pink overprint). Injected once, reference counted.
 */

const CSS = `
/* Chalk button: under the map button, same plate */
.sk-chalkbtn{position:absolute;top:calc(var(--sk-st) + var(--sk-gap) + 54px);left:calc(var(--sk-sl) + var(--sk-gap));z-index:3;
  width:46px;height:46px;padding:0;border:0;margin:0;border-radius:3px;pointer-events:auto;touch-action:manipulation;
  background:var(--sk-ink);display:flex;align-items:center;justify-content:center;cursor:pointer;
  box-shadow:2px 2px 0 rgba(31,63,191,.55),-1px 0 0 rgba(255,46,136,.45)}
.sk-chalkbtn svg{width:30px;height:30px;display:block}
.sk-chalkbtn .sk-stoptxt,.sk-chalkbtn .sk-x{display:none}
.sk-stoptxt{font:700 12px/1 'Arial Narrow','Roboto Condensed','Helvetica Neue',Arial,sans-serif;letter-spacing:.08em;color:var(--sk-pink);
  flex-direction:column;align-items:center;gap:3px}
.sk-stoptxt i{display:block;width:12px;height:12px;border-radius:2px;background:var(--sk-pink)}
.sk-recording .sk-chalkbtn .sk-icon{display:none}
.sk-recording .sk-chalkbtn .sk-stoptxt{display:flex}
.sk-racing .sk-chalkbtn .sk-icon{display:none}
.sk-racing .sk-chalkbtn .sk-x{display:block}
.sk-debug .sk-chalkbtn{left:var(--sk-sl);width:44px;height:44px;top:calc(var(--sk-st) + var(--sk-gap) + 52px)}
.sk-open .sk-chalkbtn,.sk-chalkopen .sk-chalkbtn,.sk-chalkopen .sk-mapbtn{display:none}

/* Chalk screen */
.sk-chalk{position:absolute;inset:0;z-index:4;pointer-events:auto;display:none;flex-direction:column;background:var(--sk-paper);
  text-transform:uppercase;letter-spacing:.05em;touch-action:none}
.sk-chalkopen .sk-chalk{display:flex}
.sk-chalk.sk-r1{transform:translateY(34%)}
.sk-chalk.sk-r2{transform:translateY(10%)}
.sk-maphead.sk-chalkhead{padding-left:calc(var(--sk-sl) + 10px)}
.sk-chalkbody{position:relative;flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;touch-action:pan-y;
  padding:14px calc(var(--sk-sr) + 10px) 14px calc(var(--sk-sl) + 10px);
  background:repeating-linear-gradient(-8deg,rgba(31,63,191,.05) 0 2px,transparent 2px 9px),#E2D6C1}
.sk-clist{flex:none;display:flex;flex-direction:column;gap:10px;
  filter:drop-shadow(2px 2px 0 rgba(27,26,46,.6)) drop-shadow(-1px 0 0 rgba(255,46,136,.5))}
.sk-cticket,.sk-ccard{padding:9px 10px 10px 32px}
.sk-cticket .sk-op,.sk-ccard .sk-op{font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.sk-cfacts,.sk-cresrows{display:flex;align-items:baseline;gap:6px;margin-top:5px;color:var(--sk-ink)}
.sk-cfact{color:var(--sk-cobalt);font-size:11px;font-weight:700;letter-spacing:.14em}
.sk-cfacts b,.sk-cresrows b{font-size:17px;font-variant-numeric:tabular-nums;letter-spacing:.04em;margin-right:12px}
.sk-cfacts b.sk-cnone{color:rgba(27,26,46,.45)}
.sk-cacts{display:flex;gap:6px;margin-top:9px}
.sk-cbtn{pointer-events:auto;flex:1;min-width:0;min-height:44px;border:0;border-radius:3px;padding:0 4px;cursor:pointer;
  background:var(--sk-ink);color:var(--sk-paper);font:700 13px/1 'Arial Narrow','Roboto Condensed','Helvetica Neue',Arial,sans-serif;
  letter-spacing:.1em;text-transform:uppercase;box-shadow:1px 1px 0 rgba(31,63,191,.7),-1px 0 0 rgba(255,46,136,.45)}
.sk-cbtn.sk-crace{background:var(--sk-mango);color:var(--sk-ink)}
.sk-cbtn.sk-csure{background:var(--sk-pink);color:var(--sk-paper)}
.sk-cbtn:disabled{opacity:.38;cursor:default}
.sk-cpunch{top:9px;bottom:auto;right:12px;border-color:var(--sk-pink);color:var(--sk-pink)}
.sk-chalkfoot{flex:none;background:var(--sk-ink);padding:10px calc(var(--sk-sr) + 10px) calc(var(--sk-sb) + 12px) calc(var(--sk-sl) + 10px)}
.sk-cfootrow{display:flex;gap:8px}
.sk-cbtn.sk-cdraw{flex:1.4;min-height:54px;background:var(--sk-mango);color:var(--sk-ink);font-size:18px;letter-spacing:.16em}
.sk-cbtn.sk-cimport{min-height:54px;background:transparent;color:var(--sk-paper);box-shadow:inset 0 0 0 2px var(--sk-paper);font-size:15px}
.sk-creason{margin-top:7px;color:var(--sk-pink);font-size:12px;font-weight:700;letter-spacing:.12em}
.sk-cempty{margin:auto 8px;background:var(--sk-paper);text-align:center;color:var(--sk-ink);padding:24px 10px;border:2px dashed rgba(27,26,46,.25);border-radius:4px}
.sk-cemptyhead{font-weight:700;font-size:20px;letter-spacing:.14em;color:var(--sk-pink);text-shadow:1px 1px 0 rgba(31,63,191,.7)}
.sk-cemptybody{margin-top:8px;font-size:13px;letter-spacing:.06em;line-height:1.4;text-transform:none;color:rgba(27,26,46,.8)}
.sk-cnote{margin-top:6px;font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--sk-cobalt)}
.sk-ccode{margin:8px 0 0;padding:8px 9px;max-height:42vh;overflow-y:auto;background:#FFF9EF;color:var(--sk-ink);
  border:1px dashed rgba(27,26,46,.4);font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;letter-spacing:0;text-transform:none;
  white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;user-select:text;-webkit-user-select:text;touch-action:pan-y}
.sk-cpaste{display:block;width:100%;min-height:120px;margin-top:8px;padding:8px;resize:vertical;background:#FFF9EF;color:var(--sk-ink);
  border:1px dashed rgba(27,26,46,.45);border-radius:2px;font:16px/1.35 ui-monospace,Menlo,Consolas,monospace;letter-spacing:0;
  text-transform:none;word-break:break-all;user-select:text;-webkit-user-select:text}
.sk-cname{display:block;width:100%;height:46px;margin-top:8px;padding:0 10px;background:#FFF9EF;color:var(--sk-ink);
  border:0;border-bottom:3px solid var(--sk-ink);border-radius:2px 2px 0 0;
  font:700 20px/1 'Arial Narrow','Roboto Condensed','Helvetica Neue',Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;
  user-select:text;-webkit-user-select:text}
.sk-cvoid{display:flex;align-items:center;gap:12px;margin-top:12px;min-height:44px}
.sk-cvoidstamp{flex:none;padding:5px 10px 4px;border:3px solid var(--sk-pink);border-radius:3px;color:var(--sk-pink);
  font:700 24px/1 'Arial Narrow','Roboto Condensed',Arial,sans-serif;letter-spacing:.22em;transform:rotate(-9deg);opacity:.9;
  box-shadow:inset 0 0 0 1px rgba(255,46,136,.4)}
.sk-cvoidwhy{color:var(--sk-pink);font-weight:700;font-size:14px;letter-spacing:.08em}

/* In-play pieces */
.sk-rec{position:absolute;left:50%;bottom:calc(var(--sk-sb) + 52px);display:none;align-items:center;gap:8px;padding:7px 13px;
  transform:translateX(-50%) rotate(-2deg);background:var(--sk-ink);color:#FBF6EC;border:2px dashed rgba(251,246,236,.75);border-radius:3px;
  font-weight:700;font-size:17px;letter-spacing:.16em;font-variant-numeric:tabular-nums;
  box-shadow:2px 2px 0 rgba(31,63,191,.55),-1px 0 0 rgba(255,46,136,.45)}
.sk-rec.sk-on{display:flex}
.sk-recdot{display:block;width:11px;height:11px;border-radius:50%;background:var(--sk-pink);box-shadow:0 0 0 2px rgba(255,46,136,.35)}
.sk-reclabel{color:var(--sk-pink)}
.sk-count{position:absolute;left:50%;top:32%;display:none;padding:8px;gap:2px;transform:translate(-50%,-50%);--sk-cw:58px;--sk-ch:87px}
.sk-count.sk-on{display:flex}
.sk-count.sk-pop1{transform:translate(-50%,-50%) scale(1.22)}
.sk-count.sk-pop2{transform:translate(-50%,-50%) scale(1.08)}
.sk-split{position:absolute;left:50%;bottom:calc(var(--sk-sb) + 52px);display:none;align-items:center;gap:7px;padding:5px 9px;
  transform:translateX(-50%)}
.sk-split.sk-on{display:flex}
.sk-splitlabel{color:var(--sk-paper);font-weight:700;font-size:11px;letter-spacing:.16em}
.sk-gap{min-width:56px;text-align:right;color:var(--sk-paper);font-weight:700;font-size:21px;letter-spacing:.02em;font-variant-numeric:tabular-nums}
.sk-gap.sk-ahead{color:var(--sk-mango)}
.sk-gap.sk-behind{color:var(--sk-pink)}
.sk-cresult{position:absolute;left:50%;top:28%;width:min(calc(100vw - 48px),300px);display:none;transform:translateX(-50%);
  filter:drop-shadow(2px 2px 0 rgba(27,26,46,.6)) drop-shadow(-1px 0 0 rgba(255,46,136,.5))}
.sk-cresult.sk-on{display:block}
.sk-cresticket .sk-op{font-size:30px;letter-spacing:.2em}
.sk-cbest{width:38px;height:38px;line-height:34px;font-size:10px;border-color:var(--sk-pink);color:var(--sk-pink);top:10px;bottom:auto}
`;

let refs = 0;
let styleEl: HTMLStyleElement | null = null;

export function injectChalkStyle(): () => void {
  if (refs++ === 0) {
    styleEl = document.createElement('style');
    styleEl.dataset.sk = 'chalk';
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
