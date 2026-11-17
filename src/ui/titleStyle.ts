/**
 * Styles for the app shell (title, pause, settings, map complete, rotate card, new-version
 * ticket), in the same print look as style.ts and chalkStyle.ts: ink boards with split-flap
 * cells, paper ticket stubs, mango / pink overprint a pixel off-register, halftone dot screens.
 * Also the reduced-motion overrides: with `sk-reduced` on #ui, flips and slides land at once.
 * Injected once, reference counted.
 */

const DOTS = 'radial-gradient(circle,rgba(27,26,46,.55) 1.25px,transparent 1.7px) 0 0/7px 7px';

const CSS = `
/* Shared shell buttons */
.sk-sbtn{pointer-events:auto;min-height:48px;border:0;border-radius:3px;padding:0 12px;cursor:pointer;touch-action:manipulation;
  background:var(--sk-ink);color:var(--sk-paper);font:700 15px/1 'Arial Narrow','Roboto Condensed','Helvetica Neue',Arial,sans-serif;
  letter-spacing:.14em;text-transform:uppercase;box-shadow:2px 2px 0 rgba(31,63,191,.7),-1px 0 0 rgba(255,46,136,.5)}
.sk-sbtn.sk-crace{background:var(--sk-mango);color:var(--sk-ink)}
.sk-sbtn.sk-sdanger{background:var(--sk-pink);color:var(--sk-paper)}
.sk-sbtn:disabled{opacity:.45;cursor:default}
.sk-sbtn.sk-tplay{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;width:100%;min-height:72px;
  background:var(--sk-mango);color:var(--sk-ink);font-size:30px;letter-spacing:.3em;padding-left:calc(12px + .3em);
  box-shadow:3px 3px 0 rgba(31,63,191,.85),-2px 0 0 rgba(255,46,136,.6)}
.sk-tplaysub{font-size:12px;letter-spacing:.14em;color:rgba(27,26,46,.75)}

/* Pause button: third in the corner stack */
.sk-pausebtn{position:absolute;top:calc(var(--sk-st) + var(--sk-gap) + 108px);left:calc(var(--sk-sl) + var(--sk-gap));z-index:3;
  width:46px;height:46px;padding:0;border:0;margin:0;border-radius:3px;pointer-events:auto;touch-action:manipulation;
  background:var(--sk-ink);display:flex;align-items:center;justify-content:center;cursor:pointer;
  box-shadow:2px 2px 0 rgba(31,63,191,.55),-1px 0 0 rgba(255,46,136,.45)}
.sk-pausebtn svg{width:30px;height:30px;display:block}
.sk-debug .sk-pausebtn{left:var(--sk-sl);width:44px;height:44px;top:calc(var(--sk-st) + var(--sk-gap) + 104px)}
.sk-open .sk-pausebtn,.sk-chalkopen .sk-pausebtn{display:none}

/* Title */
.sk-title,.sk-pause,.sk-settings,.sk-complete,.sk-rotate,.sk-tconfirm{display:none}
.sk-title{position:absolute;inset:0;z-index:6;pointer-events:auto;flex-direction:column;justify-content:space-between;touch-action:none;
  background:${DOTS},linear-gradient(180deg,rgba(27,26,46,.9) 0%,rgba(27,26,46,.35) 34%,rgba(27,26,46,.2) 52%,rgba(27,26,46,.92) 86%);
  padding:calc(var(--sk-st) + 13vh) calc(var(--sk-sr) + 18px) calc(var(--sk-sb) + 30px) calc(var(--sk-sl) + 18px)}
.sk-title.sk-on{display:flex}
.sk-ttop{display:flex;flex-direction:column;align-items:center;gap:18px}
.sk-tboard{padding:9px;--sk-cw:min(48px,calc((100vw - 70px) / 6.4));--sk-ch:calc(var(--sk-cw) * 1.45);
  box-shadow:4px 4px 0 rgba(31,63,191,.8),-2px 0 0 rgba(255,46,136,.6)}
.sk-tword{gap:3px}
.sk-tword .sk-cell{border-radius:3px;font-size:calc(var(--sk-cw) * 1.18);letter-spacing:0}
.sk-tstrap{background:var(--sk-mango);color:var(--sk-ink);font-weight:700;font-size:13px;letter-spacing:.2em;padding:7px 12px 6px;
  transform:rotate(-2deg);box-shadow:2px 2px 0 var(--sk-pink),-1px -1px 0 rgba(31,63,191,.6);white-space:nowrap}
.sk-tmenu{display:flex;flex-direction:column;gap:12px;width:min(100%,340px);margin:0 auto}
.sk-trow{display:flex;gap:10px}
.sk-trow .sk-sbtn{flex:1}
.sk-sbtn.sk-tline{min-height:52px;background:var(--sk-ink);box-shadow:inset 0 0 0 2px var(--sk-paper),2px 2px 0 rgba(31,63,191,.7)}
.sk-sbtn.sk-tinstall{min-height:48px;background:var(--sk-paper);color:var(--sk-ink);box-shadow:2px 2px 0 var(--sk-pink),-1px 0 0 rgba(31,63,191,.6)}
.sk-thint{text-align:center;color:var(--sk-paper);font-weight:700;font-size:13px;letter-spacing:.12em;text-transform:none}
.sk-tconfirm{position:absolute;inset:0;z-index:2;align-items:center;justify-content:center;padding:0 18px;background:rgba(27,26,46,.55)}
.sk-tconfirm.sk-on{display:flex}
.sk-ttear{width:min(100%,340px);padding:12px 12px 16px 34px;filter:drop-shadow(3px 3px 0 rgba(27,26,46,.7))}
.sk-ttear::after{content:'';position:absolute;left:0;right:0;bottom:0;height:7px;
  background:linear-gradient(135deg,transparent 50%,rgba(27,26,46,.85) 50%) 0 0/9px 7px repeat-x,linear-gradient(-135deg,transparent 50%,rgba(27,26,46,.85) 50%) 0 0/9px 7px repeat-x}
.sk-ttear .sk-op{font-size:22px}
.sk-ttearbody{margin-top:7px;font-weight:700;font-size:14px;letter-spacing:.05em;line-height:1.35;text-transform:none;color:rgba(27,26,46,.85)}

.sk-titling .sk-board,.sk-titling .sk-mapbtn,.sk-titling .sk-chalkbtn,.sk-titling .sk-pausebtn,.sk-titling .sk-chain,
.sk-titling .sk-toasts,.sk-titling .sk-stop,.sk-titling .sk-hold,.sk-titling .sk-rec,.sk-titling .sk-split{visibility:hidden}

/* Pause */
.sk-pause{position:absolute;inset:0;z-index:6;pointer-events:auto;align-items:center;justify-content:center;touch-action:none;
  background:${DOTS},rgba(27,26,46,.45);padding:0 calc(var(--sk-sr) + 20px) 0 calc(var(--sk-sl) + 20px)}
.sk-pause.sk-on{display:flex}
.sk-pcard{width:min(100%,330px);display:flex;flex-direction:column;align-items:stretch;gap:0}
.sk-pboard{display:flex;justify-content:space-between;align-items:center;padding:7px;gap:8px;position:relative;z-index:1;
  --sk-cw:min(22px,calc((100vw - 110px) / 12));--sk-ch:calc(var(--sk-cw) * 1.5)}
.sk-pticket{display:flex;flex-direction:column;gap:10px;padding:16px 14px 18px 36px;margin-top:-3px;
  filter:drop-shadow(3px 3px 0 rgba(27,26,46,.7)) drop-shadow(-1px 0 0 rgba(255,46,136,.5))}
.sk-sbtn.sk-presume{min-height:64px;font-size:24px}
.sk-prow{margin-top:0}
.sk-prow .sk-sbtn{flex:1;min-height:48px}
.sk-sbtn.sk-pline{min-height:48px}
.sk-sbtn.sk-pquit{background:transparent;color:var(--sk-ink);box-shadow:inset 0 0 0 2px var(--sk-ink)}

/* Settings (shares the chalk screen's head, body and foot) */
.sk-settings{position:absolute;inset:0;z-index:7;pointer-events:auto;flex-direction:column;background:var(--sk-paper);
  text-transform:uppercase;letter-spacing:.05em;touch-action:none}
.sk-settings.sk-on{display:flex}
.sk-scard{padding:11px 12px 13px 34px;display:flex;flex-direction:column;gap:12px;flex:none;
  filter:drop-shadow(2px 2px 0 rgba(27,26,46,.6)) drop-shadow(-1px 0 0 rgba(255,46,136,.5))}
.sk-scard .sk-op{font-size:17px}
.sk-srow{display:flex;flex-direction:column;gap:6px}
.sk-shead{display:flex;align-items:center;justify-content:space-between}
.sk-slabel{color:var(--sk-cobalt);font-size:13px;font-weight:700;letter-spacing:.16em}
.sk-sval{--sk-cw:15px;--sk-ch:22px}
.sk-strack{display:flex;align-items:stretch;gap:4px}
.sk-sbtn.sk-sstep{flex:none;width:40px;min-height:44px;padding:0;font-size:22px;letter-spacing:0}
.sk-scells{flex:1;display:flex;gap:2px;min-width:0}
.sk-sbtn.sk-scell{flex:1;min-width:0;min-height:44px;padding:0;border-radius:2px;box-shadow:none;
  background:linear-gradient(#34335A 0 50%,#28274A 50% 100%);position:relative}
.sk-sbtn.sk-scell::after{content:'';position:absolute;left:0;right:0;top:50%;height:1px;background:rgba(10,9,24,.85)}
.sk-sbtn.sk-scell.sk-lit{background:linear-gradient(#FFBE45 0 50%,var(--sk-mango) 50% 100%);box-shadow:1px 1px 0 rgba(31,63,191,.8)}
.sk-sswitch{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
.sk-swords{display:flex;flex-direction:column;gap:3px;min-width:0}
.sk-snote{font-size:11px;font-weight:700;letter-spacing:.06em;color:rgba(27,26,46,.62);text-transform:none}
.sk-sbtn.sk-stoggle{flex:none;padding:0 8px;min-height:44px;--sk-cw:15px;--sk-ch:24px;background:var(--sk-ink)}
.sk-sbtn.sk-stoggle .sk-cell{color:rgba(243,235,221,.55)}
.sk-sbtn.sk-stoggle.sk-lit .sk-cell{color:var(--sk-mango)}
.sk-sinstall .sk-sbtn{align-self:flex-start}
.sk-sresetrow{gap:6px}
.sk-sbtn.sk-sreset{align-self:flex-start;background:transparent;color:var(--sk-pink);box-shadow:inset 0 0 0 2px var(--sk-pink)}
.sk-sbtn.sk-sreset.sk-sdanger{background:var(--sk-pink);color:var(--sk-paper)}
.sk-scredits{flex:none;text-align:center;padding:4px 10px 10px;color:rgba(27,26,46,.7)}
.sk-scredhead{font-weight:700;font-size:14px;letter-spacing:.22em;color:var(--sk-pink);text-shadow:1px 1px 0 rgba(31,63,191,.6)}
.sk-scredbody{margin-top:4px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:none;line-height:1.4}

/* Map complete */
.sk-complete{position:absolute;inset:0;z-index:8;pointer-events:auto;flex-direction:column;background:var(--sk-paper);
  text-transform:uppercase;letter-spacing:.05em;touch-action:none}
.sk-complete.sk-on{display:flex}
.sk-complete .sk-maphead .sk-flap{--sk-cw:min(17px,calc((100vw - 40px) / 13));--sk-ch:calc(var(--sk-cw) * 1.5)}
.sk-xbody{justify-content:center;gap:16px}
.sk-xstamp{flex:none;align-self:center;width:128px;height:128px;border-radius:50%;border:4px solid var(--sk-pink);color:var(--sk-pink);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;transform:rotate(-12deg);opacity:.88;
  box-shadow:inset 0 0 0 3px var(--sk-paper),inset 0 0 0 5px rgba(255,46,136,.7);font-weight:700;text-align:center}
.sk-xstamp b{font-size:20px;letter-spacing:.1em;line-height:1}
.sk-xstamp span{font-size:9px;letter-spacing:.18em}
.sk-xhero{flex:none;text-align:center;padding:8px 0 4px}
.sk-xkicker{font-weight:700;font-size:13px;letter-spacing:.24em;color:var(--sk-cobalt)}
.sk-xtitle span{display:block}
.sk-xtitle{margin-top:6px;font-weight:700;font-size:38px;line-height:.98;letter-spacing:.06em;color:var(--sk-pink);
  text-shadow:2px 2px 0 rgba(31,63,191,.85),-1px 0 0 rgba(255,174,26,.9)}
.sk-xgrid{flex:none;display:grid;grid-template-columns:repeat(auto-fit,108px);justify-content:center;gap:9px;
  filter:drop-shadow(2px 2px 0 rgba(27,26,46,.6)) drop-shadow(-1px 0 0 rgba(255,46,136,.5))}
.sk-xcell{position:relative;background:var(--sk-paper);padding:9px 6px 8px;display:flex;flex-direction:column;align-items:center;gap:6px;
  border-radius:2px;--sk-cw:16px;opacity:.5;
  -webkit-mask:radial-gradient(circle at 50% 0,#0000 4px,#000 4.6px) 0 0/12px 100% repeat-x;
  mask:radial-gradient(circle at 50% 0,#0000 4px,#000 4.6px) 0 0/12px 100% repeat-x}
.sk-xcell.sk-punched{opacity:1}
.sk-xcell.sk-pop1{transform:scale(1.18)}
.sk-xcell.sk-pop2{transform:scale(1.06)}
.sk-xhole{position:absolute;right:7px;top:7px;width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 2px rgba(27,26,46,.25)}
.sk-punched .sk-xhole{background:var(--sk-ink);box-shadow:0 0 0 2px var(--sk-pink)}
.sk-xname{font-weight:700;font-size:11px;letter-spacing:.06em;color:var(--sk-ink);text-align:center;line-height:1.15;
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sk-xfacts{flex:none;padding:10px 12px 12px 34px}
.sk-xfacts .sk-cfacts{margin-top:0;justify-content:space-between}
.sk-xfacts b{font-size:22px}
.sk-sbtn.sk-xcontinue{min-height:62px;font-size:24px}

/* New version ticket */
.sk-update{position:absolute;left:50%;bottom:calc(var(--sk-sb) + 64px);z-index:10;display:none;width:min(calc(100vw - 32px),340px);
  transform:translateX(-50%);pointer-events:auto;filter:drop-shadow(2px 2px 0 rgba(27,26,46,.65)) drop-shadow(-1px 0 0 rgba(255,46,136,.5))}
.sk-update.sk-on{display:block}
.sk-uticket{padding:9px 10px 10px 32px}
.sk-urow{display:flex;align-items:center;gap:10px;margin-top:4px}
.sk-urow .sk-tbody{margin-top:0;flex:1;min-width:0}
.sk-sbtn.sk-ureload{flex:none;min-height:44px}

/* Rotate card */
.sk-rotate{position:absolute;inset:0;z-index:12;pointer-events:auto;align-items:center;justify-content:center;touch-action:none;
  background:radial-gradient(circle,rgba(31,63,191,.55) 1.3px,transparent 1.8px) 0 0/8px 8px,var(--sk-ink)}
.sk-rotate.sk-on{display:flex}
.sk-rotcard{display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 26px 18px 44px;text-align:center;
  filter:drop-shadow(3px 3px 0 rgba(31,63,191,.8))}
.sk-rotphone{width:96px;height:96px;display:block}
.sk-rothead{font-size:22px}
.sk-rotbody{margin-top:0}

/* Reduced motion: flips and slides land at once */
#ui.sk-reduced .sk-f1,#ui.sk-reduced .sk-f2{transform:none;color:var(--sk-mango)}
#ui.sk-reduced .sk-r1,#ui.sk-reduced .sk-r2,#ui.sk-reduced .sk-in1,#ui.sk-reduced .sk-in2,#ui.sk-reduced .sk-out1,#ui.sk-reduced .sk-out2,
#ui.sk-reduced .sk-up1,#ui.sk-reduced .sk-up2,#ui.sk-reduced .sk-pop1,#ui.sk-reduced .sk-pop2{transform:none}
#ui.sk-reduced .sk-count.sk-pop1,#ui.sk-reduced .sk-count.sk-pop2{transform:translate(-50%,-50%)}
`;

let refs = 0;
let styleEl: HTMLStyleElement | null = null;

export function injectShellStyle(): () => void {
  if (refs++ === 0) {
    styleEl = document.createElement('style');
    styleEl.dataset.sk = 'shell';
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
