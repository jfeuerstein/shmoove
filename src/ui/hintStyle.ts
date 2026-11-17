/**
 * Styles for the onboarding hint stub and the map pointer, in the print look of style.ts: a small
 * perforated paper stub low on the screen, above the hold cue, with a thumb glyph, a few condensed
 * words and a punched hole. Injected once, reference counted.
 */

const CSS = `
.sk-hint{position:absolute;left:50%;bottom:calc(var(--sk-sb) + 50px);z-index:1;display:none;
  transform:translateX(-50%);max-width:min(calc(100vw - 24px),340px);
  filter:drop-shadow(2px 2px 0 rgba(27,26,46,.6)) drop-shadow(-1px 0 0 rgba(255,46,136,.5))}
.sk-hint.sk-on{display:block}
/* Slides up into place and back down, on twos. */
.sk-hint.sk-in1,.sk-hint.sk-out2{transform:translate(-50%,130%)}
.sk-hint.sk-in2,.sk-hint.sk-out1{transform:translate(-50%,45%)}
/* A hint up hides the stop timetable board (as an errand offer does), so the stub stays low, clear
   of the skater and the ride it is about; the hold cue goes back under it. */
.sk-hinting .sk-stop{visibility:hidden}
.sk-hinting.sk-stopup .sk-hold{bottom:calc(var(--sk-sb) + 16px)}
.sk-titling .sk-hint,.sk-titling .sk-hmapptr{visibility:hidden}
.sk-hticket{display:flex;align-items:center;gap:8px;padding:5px 38px 5px 31px;min-height:54px}
.sk-hglyph{flex:none;width:44px;height:44px}
.sk-hglyph svg{display:block;width:100%;height:100%;overflow:visible}
.sk-hglyph .sk-fr{display:none}
.sk-hglyph.sk-g0 .sk-fr0,.sk-hglyph.sk-g1 .sk-fr1,.sk-hglyph.sk-g2 .sk-fr2{display:inline}
.sk-htext{display:flex;flex-direction:column;gap:2px;min-width:0}
.sk-htitle{font-weight:700;font-size:17px;line-height:1.05;letter-spacing:.08em;color:var(--sk-ink);white-space:nowrap;
  text-shadow:1px 1px 0 rgba(255,46,136,.45)}
.sk-hlong .sk-htitle{font-size:14px;letter-spacing:.06em}
.sk-hsub{font-weight:700;font-size:12px;line-height:1.15;letter-spacing:.1em;color:var(--sk-cobalt);text-wrap:balance;
  text-shadow:-1px 0 0 rgba(255,46,136,.35)}
.sk-hsub:empty{display:none}
/* The punched hole: an empty ring until the step is learnt, then punched through. */
.sk-hhole{position:absolute;right:12px;top:50%;width:18px;height:18px;margin-top:-9px;border-radius:50%;
  background:rgba(27,26,46,.07);box-shadow:inset 0 0 0 2px var(--sk-ink)}
.sk-hdone .sk-hhole{background:var(--sk-ink);box-shadow:0 0 0 2px var(--sk-pink)}
.sk-hhole.sk-p1{transform:scale(1.45)}
.sk-hhole.sk-p2{transform:scale(.8)}
/* The map pointer: a mango ring round the map button, pulsing on twos. It covers nothing else. */
.sk-hmapptr{position:absolute;z-index:4;display:none;width:56px;height:56px;pointer-events:none;border-radius:6px;
  top:calc(var(--sk-st) + var(--sk-gap) - 5px);left:calc(var(--sk-sl) + var(--sk-gap) - 5px);
  box-shadow:inset 0 0 0 3px var(--sk-mango),inset 0 0 0 5px var(--sk-ink),0 0 0 2px var(--sk-ink)}
.sk-debug .sk-hmapptr{left:calc(var(--sk-sl) - 5px);width:54px;height:54px}
.sk-hmapptr.sk-on{display:block}
.sk-hmapptr.sk-b1{transform:scale(1.12)}
.sk-reduced .sk-hglyph .sk-fr{display:none}
.sk-reduced .sk-hglyph .sk-frs{display:inline}
.sk-reduced .sk-hint.sk-in1,.sk-reduced .sk-hint.sk-in2,.sk-reduced .sk-hint.sk-out1,.sk-reduced .sk-hint.sk-out2{transform:translateX(-50%)}
.sk-reduced .sk-hmapptr.sk-b1{transform:none}
@media (prefers-reduced-motion: reduce){
  .sk-hglyph .sk-fr{display:none}
  .sk-hglyph .sk-frs{display:inline}
  .sk-hint.sk-in1,.sk-hint.sk-in2,.sk-hint.sk-out1,.sk-hint.sk-out2{transform:translateX(-50%)}
  .sk-hmapptr.sk-b1{transform:none}
}
`;

let refs = 0;
let styleEl: HTMLStyleElement | null = null;

/** Inject the stylesheet (once, however many UIs are created). Returns a release function. */
export function injectHintStyle(): () => void {
  if (refs++ === 0) {
    styleEl = document.createElement('style');
    styleEl.dataset.sk = 'hint';
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
