/**
 * Styles for the ledger button (fourth in the corner stack) and the ledger screen, in the print
 * look of style.ts and chalkStyle.ts. Injected once, reference counted.
 */

const CSS = `
/* Ledger button: under the pause button, same plate */
.sk-ledgerbtn{position:absolute;top:calc(var(--sk-st) + var(--sk-gap) + 162px);left:calc(var(--sk-sl) + var(--sk-gap));z-index:3;
  width:46px;height:46px;padding:0;border:0;margin:0;border-radius:3px;pointer-events:auto;touch-action:manipulation;
  background:var(--sk-ink);display:flex;align-items:center;justify-content:center;cursor:pointer;
  box-shadow:2px 2px 0 rgba(31,63,191,.55),-1px 0 0 rgba(255,46,136,.45)}
.sk-ledgerbtn svg{width:30px;height:30px;display:block}
.sk-ledgerbtn .sk-ldot{position:absolute;right:4px;top:4px;width:9px;height:9px;border-radius:50%;background:var(--sk-pink);display:none;
  box-shadow:0 0 0 2px var(--sk-ink)}
.sk-ledgerbtn.sk-news .sk-ldot{display:block}
.sk-debug .sk-ledgerbtn{left:var(--sk-sl);width:44px;height:44px;top:calc(var(--sk-st) + var(--sk-gap) + 156px)}
.sk-open .sk-ledgerbtn,.sk-chalkopen .sk-ledgerbtn,.sk-ledgeropen .sk-ledgerbtn,
.sk-ledgeropen .sk-mapbtn,.sk-ledgeropen .sk-chalkbtn,.sk-ledgeropen .sk-pausebtn{display:none}
.sk-titling .sk-ledgerbtn{visibility:hidden}

/* Ledger screen */
.sk-ledger{position:absolute;inset:0;z-index:4;pointer-events:auto;display:none;flex-direction:column;background:var(--sk-paper);
  text-transform:uppercase;letter-spacing:.05em;touch-action:none}
.sk-ledgeropen .sk-ledger{display:flex}
.sk-ledger.sk-r1{transform:translateY(34%)}
.sk-ledger.sk-r2{transform:translateY(10%)}
.sk-maphead.sk-ledgerhead{padding-left:calc(var(--sk-sl) + 10px)}
.sk-ltabs{flex:none;display:flex;flex-direction:column;gap:4px;padding:8px calc(var(--sk-sr) + 10px) 8px calc(var(--sk-sl) + 10px);
  background:var(--sk-ink2);--sk-cw:clamp(12px,calc((100vw - 60px) / 17),16px)}
.sk-ltab{pointer-events:auto;display:flex;align-items:center;justify-content:space-between;gap:6px;min-height:44px;padding:4px 6px;border:0;
  cursor:pointer;width:100%}
.sk-ltab.sk-sel{box-shadow:inset 0 0 0 2px var(--sk-mango),2px 2px 0 rgba(31,63,191,.55)}
.sk-ltab:not(.sk-sel) .sk-cell{color:#C9A55E}
.sk-ledgerbody{position:relative;flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;touch-action:pan-y;
  padding:14px calc(var(--sk-sr) + 10px) calc(var(--sk-sb) + 18px) calc(var(--sk-sl) + 10px);
  background:repeating-linear-gradient(-8deg,rgba(31,63,191,.05) 0 2px,transparent 2px 9px),#E2D6C1}
.sk-lticket{padding:9px 10px 10px 32px}
.sk-lticket .sk-op{font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.sk-lticket .sk-serial{flex:none}
.sk-lticket.sk-ldone{padding-right:58px}
.sk-lstamp{top:auto;bottom:9px;right:12px;width:40px;height:40px;line-height:36px;font-size:12px;border-color:var(--sk-pink);color:var(--sk-pink);
  transform:rotate(-16deg)}
.sk-lwhere{margin-top:6px;font-size:12px;font-weight:700;letter-spacing:.08em;color:var(--sk-cobalt)}
.sk-lnow{display:flex;align-items:center;gap:8px;margin-top:8px}
.sk-lnowtxt{flex:1;color:var(--sk-pink);font-weight:700;font-size:13px;letter-spacing:.1em;font-variant-numeric:tabular-nums}
.sk-lnow .sk-cbtn{flex:none;padding:0 14px}
.sk-lrows{display:flex;flex-direction:column;gap:5px}
.sk-lrow{display:flex;align-items:center;gap:9px;min-height:50px;padding:7px 9px;border-radius:3px;background:var(--sk-ink);color:var(--sk-paper);
  box-shadow:2px 2px 0 rgba(31,63,191,.45),-1px 0 0 rgba(255,46,136,.35);--sk-cw:14px}
.sk-lrowtxt{flex:1;min-width:0}
.sk-lrowtask{font-weight:700;font-size:14px;line-height:1.15;letter-spacing:.05em;color:var(--sk-mango)}
.sk-lrowsub{margin-top:3px;font-size:11px;font-weight:700;letter-spacing:.1em;color:#C9C1B3}
.sk-lrow.sk-lpunched .sk-lrowtask{color:var(--sk-paper)}
.sk-lsecret:not(.sk-lpunched) .sk-lrowtask{color:#8C86B0;letter-spacing:.3em}
.sk-lstar{flex:none;width:calc(var(--sk-cw) * 2 + 1px);height:calc(var(--sk-cw) * 1.5);display:flex;align-items:center;justify-content:center;
  border-radius:3px;background:#3A3960;color:var(--sk-paper);font-weight:700;font-size:16px}
.sk-lstar.sk-on{background:var(--sk-mango);
  clip-path:polygon(50% 0,61% 34%,97% 35%,68% 56%,79% 91%,50% 70%,21% 91%,32% 56%,3% 35%,39% 34%)}

/* Line map: a conductor's punch per line, and the secrets count in the title strip */
.sk-legcond{flex:none;width:18px;height:18px;border-radius:3px;display:flex;align-items:center;justify-content:center;
  box-shadow:inset 0 0 0 2px #3A3960}
.sk-legcond svg{width:14px;height:14px;display:block;opacity:.35}
.sk-legcond.sk-done{background:var(--sk-pink);box-shadow:none}
.sk-legcond.sk-done svg{opacity:1}
.sk-mapsecrets{color:var(--sk-pink);margin-left:10px}
`;

let refs = 0;
let styleEl: HTMLStyleElement | null = null;

export function injectLedgerStyle(): () => void {
  if (refs++ === 0) {
    styleEl = document.createElement('style');
    styleEl.dataset.sk = 'ledger';
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
