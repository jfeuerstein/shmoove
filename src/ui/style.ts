/**
 * The UI's print look, as one injected stylesheet. Destination boards: mango condensed capitals in
 * split-flap cells on ink. Ticket stubs: perforated paper with a punched hole and pink / cobalt
 * overprint a pixel off-register. No images, no web fonts. Everything is prefixed `sk-`.
 */

const CSS = `
#ui{
  --sk-ink:#1B1A2E;--sk-ink2:#2B2A47;--sk-mango:#FFAE1A;--sk-pink:#FF2E88;--sk-cobalt:#1F3FBF;
  --sk-paper:#F3EBDD;--sk-teal:#00A99D;
  --sk-st:env(safe-area-inset-top,0px);--sk-sb:env(safe-area-inset-bottom,0px);
  --sk-sl:env(safe-area-inset-left,0px);--sk-sr:env(safe-area-inset-right,0px);
  --sk-cw:clamp(12px,calc((100vw - 100px) / 17.5),17px);
  --sk-ch:calc(var(--sk-cw) * 1.5);
  --sk-gap:8px;
  --sk-top2:calc(var(--sk-st) + 22px + var(--sk-ch) * 2);
  font-family:'Arial Narrow','Roboto Condensed','Helvetica Neue',Arial,sans-serif;
  font-stretch:condensed;
}
#ui .sk-hud,#ui .sk-hud *{box-sizing:border-box}
.sk-hud{position:absolute;inset:0;pointer-events:none;overflow:hidden;text-transform:uppercase;letter-spacing:.04em}

/* Split-flap cells */
.sk-flap{display:inline-flex;gap:1px;flex:none}
.sk-cell{position:relative;display:block;width:var(--sk-cw);height:var(--sk-ch);border-radius:2px;overflow:hidden;
  background:linear-gradient(#34335A 0 50%,#28274A 50% 100%);color:var(--sk-mango);
  font-weight:700;font-size:calc(var(--sk-cw) * 1.12);line-height:var(--sk-ch);text-align:center;
  font-variant-numeric:tabular-nums;transform-origin:50% 50%}
.sk-cell::after{content:'';position:absolute;left:0;right:0;top:50%;height:1px;margin-top:-.5px;background:rgba(10,9,24,.85)}
/* Flip on twos (classes stepped by twos.ts): the top flap falls, then lands. */
.sk-f1{transform:scaleY(.14);color:#FFE2A6}
.sk-f2{transform:scaleY(.62);color:#FFCB66}
.sk-pinkflap .sk-cell{color:var(--sk-pink)}

.sk-panel{background:var(--sk-ink);border-radius:3px;box-shadow:2px 2px 0 rgba(31,63,191,.55),-1px 0 0 rgba(255,46,136,.45)}
.sk-row{display:flex;align-items:center;gap:1px;justify-content:space-between}
.sk-row>.sk-flap:last-child{margin-left:6px}
.sk-slot{width:calc(var(--sk-cw) * 2 + 1px);height:var(--sk-ch);flex:none;display:flex;align-items:center;justify-content:center;
  color:var(--sk-mango);font-weight:700;font-size:calc(var(--sk-cw) * .66);letter-spacing:.06em;margin-right:1px}
.sk-slot.sk-arrow{font-size:calc(var(--sk-cw) * 1.1)}

/* Line badge: livery base with the stripe as a band */
.sk-badge{display:inline-flex;align-items:center;justify-content:center;flex:none;
  width:calc(var(--sk-cw) * 2 + 1px);height:var(--sk-ch);border-radius:3px;font-weight:700;
  font-size:calc(var(--sk-cw) * .82);letter-spacing:.02em;line-height:1;
  background:linear-gradient(var(--sk-base) 0 64%,var(--sk-stripe) 64% 80%,var(--sk-base) 80% 100%);
  box-shadow:inset 0 0 0 1px rgba(27,26,46,.35)}

/* Destination board */
.sk-board{position:absolute;top:calc(var(--sk-st) + var(--sk-gap));left:calc(var(--sk-sl) + 60px);right:calc(var(--sk-sr) + var(--sk-gap));
  padding:5px;display:flex;flex-direction:column;gap:3px}

/* Map button */
.sk-mapbtn{position:absolute;top:calc(var(--sk-st) + var(--sk-gap));left:calc(var(--sk-sl) + var(--sk-gap));z-index:3;
  width:46px;height:46px;padding:0;border:0;margin:0;border-radius:3px;pointer-events:auto;touch-action:manipulation;
  background:var(--sk-ink);display:flex;align-items:center;justify-content:center;cursor:pointer;
  box-shadow:2px 2px 0 rgba(31,63,191,.55),-1px 0 0 rgba(255,46,136,.45)}
.sk-mapbtn svg{width:30px;height:30px;display:block}
.sk-mapbtn .sk-x{display:none}
.sk-open .sk-mapbtn .sk-x{display:block}
.sk-open .sk-mapbtn .sk-icon{display:none}
.sk-debug .sk-mapbtn{left:var(--sk-sl);width:44px;height:44px}

/* Chain meter */
.sk-chain{position:absolute;top:var(--sk-top2);right:calc(var(--sk-sr) + var(--sk-gap));padding:5px 6px 6px;display:none;
  flex-direction:column;align-items:flex-end;gap:4px;min-width:calc(var(--sk-cw) * 3 + 14px)}
.sk-chain.sk-on{display:flex}
.sk-pips{display:flex;gap:3px;justify-content:flex-end}
.sk-pip{width:9px;height:9px;border-radius:50%;background:var(--sk-mango);box-shadow:1px 1px 0 var(--sk-cobalt)}
.sk-lost .sk-pip{background:var(--sk-pink)}
.sk-bar{width:100%;height:4px;background:#3A3960;border-radius:2px;overflow:hidden;visibility:hidden}
.sk-bar.sk-on{visibility:visible}
.sk-bar i{display:block;height:100%;background:var(--sk-pink);transform-origin:0 50%}

/* Hold cue */
.sk-hold{position:absolute;left:50%;bottom:calc(var(--sk-sb) + 16px);width:22px;height:22px;margin-left:-11px;border-radius:50%;
  border:3px solid var(--sk-mango);opacity:0;box-shadow:0 0 0 2px rgba(27,26,46,.45),inset 0 0 0 1px rgba(27,26,46,.45)}
.sk-hold.sk-on{opacity:.92}
.sk-hold.sk-full{background:var(--sk-mango)}
.sk-stopup .sk-hold{bottom:calc(var(--sk-sb) + 30px + (var(--sk-ch) + 3px) * 5 + 12px)}

/* Ticket stubs */
/* Right of the map and chalk buttons. */
.sk-toasts{position:absolute;top:var(--sk-top2);left:calc(var(--sk-sl) + 62px);width:min(calc(100vw - 150px),270px);
  display:flex;flex-direction:column;gap:6px;
  filter:drop-shadow(2px 2px 0 rgba(27,26,46,.6)) drop-shadow(-1px 0 0 rgba(255,46,136,.5))}
.sk-ticket{position:relative;background:var(--sk-paper);color:var(--sk-ink);padding:7px 10px 8px 30px;
  -webkit-mask:radial-gradient(circle at 0 5px,#0000 3.4px,#000 4px) 0 0/100% 10px repeat-y,radial-gradient(circle at 15px 50%,#0000 5px,#000 5.7px);
  -webkit-mask-composite:source-in;
  mask:radial-gradient(circle at 0 5px,#0000 3.4px,#000 4px) 0 0/100% 10px repeat-y,radial-gradient(circle at 15px 50%,#0000 5px,#000 5.7px);
  mask-composite:intersect}
.sk-ticket::before{content:'';position:absolute;left:24px;top:4px;bottom:4px;border-left:2px dotted rgba(27,26,46,.35)}
.sk-ticket.sk-in1,.sk-ticket.sk-out2{transform:translateX(-80%)}
.sk-ticket.sk-in2,.sk-ticket.sk-out1{transform:translateX(-34%)}
.sk-thead{display:flex;align-items:center;gap:6px}
.sk-op{color:var(--sk-pink);font-weight:700;font-size:15px;letter-spacing:.1em;text-shadow:1px 1px 0 rgba(31,63,191,.8)}
.sk-serial{margin-left:auto;font:10px/1 ui-monospace,Menlo,Consolas,monospace;color:var(--sk-cobalt);letter-spacing:0;
  text-shadow:-1px 0 0 rgba(255,46,136,.5)}
.sk-tbody{margin-top:4px;font-weight:700;font-size:14px;letter-spacing:.05em;color:var(--sk-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sk-ticket .sk-badge{--sk-cw:13px}
.sk-ticket.sk-big{padding-top:10px;padding-bottom:11px}
.sk-ticket.sk-big .sk-op{font-size:19px}
.sk-ticket.sk-big .sk-tbody{font-size:16px}
.sk-stamp{position:absolute;right:10px;bottom:6px;width:26px;height:26px;border-radius:50%;border:2px solid var(--sk-cobalt);
  color:var(--sk-cobalt);font:700 9px/22px 'Arial Narrow',Arial,sans-serif;text-align:center;transform:rotate(-14deg);opacity:.8}
.sk-ticket.sk-big{-webkit-mask:radial-gradient(circle at 0 5px,#0000 3.4px,#000 4px) 0 0/100% 10px repeat-y,radial-gradient(circle at 15px 30%,#0000 5px,#000 5.7px),radial-gradient(circle at 15px 70%,#0000 5px,#000 5.7px);
  -webkit-mask-composite:source-in;
  mask:radial-gradient(circle at 0 5px,#0000 3.4px,#000 4px) 0 0/100% 10px repeat-y,radial-gradient(circle at 15px 30%,#0000 5px,#000 5.7px),radial-gradient(circle at 15px 70%,#0000 5px,#000 5.7px);
  mask-composite:intersect}

/* Stop timetable board */
.sk-stop{position:absolute;left:calc(var(--sk-sl) + var(--sk-gap));right:calc(var(--sk-sr) + var(--sk-gap));bottom:calc(var(--sk-sb) + var(--sk-gap));
  padding:6px;display:flex;flex-direction:column;gap:3px;align-items:stretch;
  transform:translateY(calc(100% + 24px))}
.sk-stop.sk-up1{transform:translateY(62%)}
.sk-stop.sk-up2{transform:translateY(22%)}
.sk-stop.sk-on{transform:none}
.sk-stop .sk-row{justify-content:flex-start}
.sk-stop .sk-row>.sk-flap:last-child{margin-left:auto}
.sk-stop .sk-title .sk-slot{color:var(--sk-paper)}

/* Line map */
.sk-map{position:absolute;inset:0;z-index:2;pointer-events:auto;display:none;flex-direction:column;background:var(--sk-paper);
  text-transform:uppercase;letter-spacing:.05em;touch-action:none}
.sk-open .sk-map{display:flex}
.sk-map.sk-r1{transform:translateY(34%)}
.sk-map.sk-r2{transform:translateY(10%)}
.sk-maphead{background:var(--sk-ink);display:flex;align-items:center;gap:8px;flex:none;
  padding:calc(var(--sk-st) + 8px) calc(var(--sk-sr) + 8px) 8px calc(var(--sk-sl) + 62px);min-height:62px}
.sk-maphead .sk-flap{margin:0}
.sk-close{margin-left:auto;pointer-events:auto;border:0;border-radius:3px;background:var(--sk-mango);color:var(--sk-ink);
  font:700 13px/1 'Arial Narrow','Roboto Condensed','Helvetica Neue',Arial,sans-serif;letter-spacing:.1em;
  min-width:44px;height:44px;padding:0 10px;text-transform:uppercase;cursor:pointer}
.sk-mapbody{position:relative;flex:1;min-height:0;overflow:hidden}
.sk-mapbody svg{position:absolute;inset:0;width:100%;height:100%;display:block}
.sk-maptitle{position:absolute;left:12px;top:8px;font-weight:700;font-size:13px;letter-spacing:.18em;color:var(--sk-ink);
  text-shadow:1px 1px 0 rgba(255,46,136,.55)}
.sk-legend{flex:none;max-height:38%;overflow-y:auto;background:var(--sk-ink);display:flex;flex-direction:column;gap:4px;
  padding:6px calc(var(--sk-sr) + 8px) calc(var(--sk-sb) + 8px) calc(var(--sk-sl) + 8px);touch-action:pan-y}
.sk-leg{pointer-events:auto;display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-height:44px;padding:6px 8px;border:0;border-radius:3px;
  background:#28274A;color:var(--sk-paper);font:700 14px/1.1 'Arial Narrow','Roboto Condensed','Helvetica Neue',Arial,sans-serif;
  letter-spacing:.06em;text-transform:uppercase;text-align:left;cursor:pointer;--sk-cw:14px}
.sk-leg.sk-sel{box-shadow:inset 0 0 0 2px var(--sk-mango)}
.sk-legname{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sk-legcount{color:var(--sk-mango);font-variant-numeric:tabular-nums;letter-spacing:.02em}
.sk-punch{width:16px;height:16px;border-radius:50%;flex:none;box-shadow:inset 0 0 0 2px #3A3960}
.sk-punch.sk-done{background:var(--sk-paper);box-shadow:inset 0 0 0 2px var(--sk-paper),0 0 0 2px var(--sk-pink)}
.sk-legstops{flex-basis:100%;display:none;font-size:11px;color:#C9C1B3;letter-spacing:.08em;white-space:normal}
.sk-leg.sk-sel .sk-legstops{display:block}
`;

let refs = 0;
let styleEl: HTMLStyleElement | null = null;

/** Inject the stylesheet (once, however many UIs are created). Returns a release function. */
export function injectStyle(): () => void {
  if (refs++ === 0) {
    styleEl = document.createElement('style');
    styleEl.dataset.sk = 'ui';
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
