/**
 * Styles for the errand offer ticket and stub, the conductor chip and the new ticket toasts, in the
 * print look of style.ts (paper stubs, ink plates, mango and pink overprint). Injected once,
 * reference counted.
 */

const CSS = `
/* Offer ticket: slides up at the bottom, above the hold cue */
.sk-offer{position:absolute;left:50%;bottom:calc(var(--sk-sb) + 48px);width:min(calc(100vw - 32px),330px);display:none;
  transform:translateX(-50%);z-index:1;
  filter:drop-shadow(2px 2px 0 rgba(27,26,46,.6)) drop-shadow(-1px 0 0 rgba(255,46,136,.5))}
.sk-offer.sk-on{display:block}
.sk-offer.sk-up1{transform:translate(-50%,70%)}
.sk-offer.sk-up2{transform:translate(-50%,22%)}
.sk-offering .sk-stop{visibility:hidden}
.sk-oticket{padding:10px 64px 12px 32px}
.sk-oticket .sk-serial{font-size:10px}
.sk-otitle{margin-top:3px;font-weight:700;font-size:21px;line-height:1.05;letter-spacing:.06em;color:var(--sk-ink);
  text-shadow:1px 1px 0 rgba(255,46,136,.45)}
.sk-obrief{margin-top:5px;font-weight:700;font-size:13px;line-height:1.25;letter-spacing:.06em;color:rgba(27,26,46,.82)}
.sk-ofacts{margin-top:6px}
.sk-ohours{display:inline-flex;align-items:baseline;gap:6px}
.sk-ohold{margin-top:7px;display:inline-block;padding:4px 8px 3px;background:var(--sk-ink);color:var(--sk-mango);border-radius:2px;
  font-weight:700;font-size:13px;letter-spacing:.2em;box-shadow:1px 1px 0 rgba(31,63,191,.7),-1px 0 0 rgba(255,46,136,.45)}
/* The punch: a ring that fills clockwise as the hold is kept, a hole when it is through */
.sk-opunch{position:absolute;right:12px;top:50%;width:42px;height:42px;margin-top:-21px;border-radius:50%;
  background:conic-gradient(var(--sk-pink) var(--sk-fill,0deg),rgba(27,26,46,.12) var(--sk-fill,0deg));
  box-shadow:inset 0 0 0 2px var(--sk-ink),0 0 0 2px rgba(255,255,255,.4)}
.sk-opunch::after{content:'';position:absolute;inset:9px;border-radius:50%;background:var(--sk-paper);box-shadow:inset 0 0 0 2px rgba(27,26,46,.5)}
.sk-opunch.sk-full::after{background:var(--sk-ink);box-shadow:none}

/* Active errand stub: under the destination board; the toasts move below it */
.sk-estub{position:absolute;top:var(--sk-top2);left:calc(var(--sk-sl) + 62px);width:min(calc(100vw - 150px),270px);display:none;
  filter:drop-shadow(2px 2px 0 rgba(27,26,46,.6)) drop-shadow(-1px 0 0 rgba(255,46,136,.5));padding:6px 10px 7px 30px}
.sk-estub.sk-on{display:block}
.sk-estub.sk-in1{transform:translateX(-80%)}
.sk-estub.sk-in2{transform:translateX(-34%)}
.sk-estub.sk-pop1{transform:scale(1.06)}
.sk-estub.sk-pop2{transform:scale(1.02)}
.sk-estub .sk-op{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.sk-eleft{margin-left:auto;flex:none;padding:2px 5px 1px;border-radius:2px;background:var(--sk-ink);color:var(--sk-mango);
  font-weight:700;font-size:15px;letter-spacing:.04em;font-variant-numeric:tabular-nums}
.sk-eleft.sk-hurry{background:var(--sk-pink);color:var(--sk-paper)}
.sk-erow{display:flex;align-items:baseline;gap:6px;margin-top:4px;min-width:0}
.sk-ecount{flex:none;color:var(--sk-cobalt);font-weight:700;font-size:11px;letter-spacing:.06em}
.sk-estep{flex:1;min-width:0;font-weight:700;font-size:13px;line-height:1.15;letter-spacing:.04em;color:var(--sk-ink)}
.sk-eprog{flex:none;color:var(--sk-pink);font-weight:700;font-size:13px;font-variant-numeric:tabular-nums}
.sk-errand .sk-toasts{top:calc(var(--sk-top2) + 70px)}

/* Conductor chip: right, under the chain meter */
.sk-cchip{position:absolute;top:calc(var(--sk-top2) + 50px);right:calc(var(--sk-sr) + var(--sk-gap));display:none;align-items:center;
  gap:6px;padding:5px 7px;--sk-cw:12px;overflow:hidden}
.sk-cchip.sk-on{display:flex}
.sk-cchip.sk-pop1{transform:scale(1.25)}
.sk-cchip.sk-pop2{transform:scale(1.08)}
.sk-cchiplabel{color:var(--sk-paper);font-weight:700;font-size:9px;letter-spacing:.16em}
.sk-cchiptext{color:var(--sk-mango);font-weight:700;font-size:15px;letter-spacing:.04em;font-variant-numeric:tabular-nums;min-width:34px;text-align:right}
.sk-cchiphole{display:none;width:14px;height:14px;border-radius:50%;background:var(--sk-paper);box-shadow:0 0 0 2px var(--sk-pink)}
.sk-cchip.sk-punched{background:var(--sk-pink)}
.sk-cchip.sk-punched .sk-cchiptext{color:var(--sk-paper)}
.sk-cchip.sk-punched .sk-cchiplabel{display:none}
.sk-cchip.sk-punched .sk-cchiphole{display:block;background:var(--sk-ink);box-shadow:0 0 0 2px var(--sk-paper)}

/* Ticket toasts: conductor tickets in the line's livery, stamped and torn errand results, secrets */
.sk-ticket[data-kind='conductor'],.sk-ticket[data-kind='conductor-punch']{background:
  linear-gradient(var(--sk-lbase,#F3EBDD) 0 86%,var(--sk-lstripe,#F3EBDD) 86% 94%,var(--sk-lbase,#F3EBDD) 94% 100%);padding-bottom:13px}
.sk-ticket[data-kind='conductor'] .sk-serial,.sk-ticket[data-kind='conductor-punch'] .sk-serial,.sk-ticket[data-kind='errand-done'] .sk-serial,
.sk-ticket[data-kind='errand-fail'] .sk-serial,.sk-ticket[data-kind='secret'] .sk-serial{white-space:nowrap;flex:none}
.sk-ticket[data-kind='conductor'] .sk-op,.sk-ticket[data-kind='conductor-punch'] .sk-op{color:var(--sk-ltext,#FF2E88)}
.sk-ticket[data-kind='conductor'] .sk-tbody,.sk-ticket[data-kind='conductor-punch'] .sk-tbody{color:var(--sk-ltext,#1B1A2E);white-space:normal;line-height:1.15}
.sk-ticket[data-kind='conductor'] .sk-serial,.sk-ticket[data-kind='conductor-punch'] .sk-serial{color:var(--sk-ltext,#1F3FBF);opacity:.8}
.sk-ticket[data-kind='conductor-punch']::after{content:'';position:absolute;right:44px;top:50%;width:16px;height:16px;margin-top:-8px;border-radius:50%;
  background:var(--sk-ink);box-shadow:0 0 0 2px var(--sk-paper)}
.sk-ticket[data-kind='errand-done'] .sk-stamp{width:auto;height:auto;padding:3px 6px 2px;border-radius:3px;line-height:1;font-size:12px;
  letter-spacing:.14em;border-color:var(--sk-pink);color:var(--sk-pink);bottom:8px;right:8px}
.sk-ticket[data-kind='errand-done'] .sk-tbody,.sk-ticket[data-kind='errand-fail'] .sk-tbody{padding-right:72px}
.sk-ebest{display:block;width:max-content;margin-top:4px;padding:1px 4px;background:var(--sk-mango);color:var(--sk-ink);border-radius:2px;font-size:11px;letter-spacing:.12em}
/* Torn: a ragged right edge and the reason struck in pink */
.sk-ticket[data-kind='errand-fail']{clip-path:polygon(0 0,92% 0,96% 14%,91% 30%,97% 46%,90% 62%,96% 78%,92% 100%,0 100%)}
.sk-ticket[data-kind='errand-fail'] .sk-op{color:var(--sk-ink);text-decoration:line-through;text-decoration-color:var(--sk-pink);text-decoration-thickness:2px}
.sk-ticket[data-kind='errand-fail'] .sk-tbody{color:var(--sk-pink)}
.sk-ticket[data-kind='secret']{background:var(--sk-ink)}
.sk-ticket[data-kind='secret'] .sk-tbody{color:var(--sk-mango)}
.sk-ticket[data-kind='secret'] .sk-serial{color:var(--sk-paper)}
.sk-ticket[data-kind='secret']::before{border-left-color:rgba(243,235,221,.35)}
.sk-titling .sk-offer,.sk-titling .sk-estub,.sk-titling .sk-cchip{visibility:hidden}
`;

let refs = 0;
let styleEl: HTMLStyleElement | null = null;

export function injectErrandStyle(): () => void {
  if (refs++ === 0) {
    styleEl = document.createElement('style');
    styleEl.dataset.sk = 'errands';
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
