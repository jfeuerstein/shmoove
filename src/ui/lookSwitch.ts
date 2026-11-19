/**
 * The look switch: one button that names the look in use and moves to the next one. Changing the
 * look reloads the page (every view was built to the old palette), so the run in progress is lost;
 * the button says so.
 */
import { LOOKS, lookOf, nextLook } from '../render/look';
import './lookSwitch.css';

export const LOOK_SWITCH_CLASS = 'look-switch';

/** What the button says for look `id`. */
export function lookLabel(id: string): string {
  const i = LOOKS.findIndex((l) => l.id === id);
  return `LOOK ${i + 1}/${LOOKS.length}: ${lookOf(id).name}`;
}

export function makeLookSwitch(doc: Document, current: string, onSwitch: (id: string) => void): HTMLElement {
  const root = doc.createElement('div');
  root.className = LOOK_SWITCH_CLASS;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'look-switch-button';
  button.textContent = lookLabel(current);
  button.addEventListener('click', () => onSwitch(nextLook(current)));
  const note = doc.createElement('div');
  note.className = 'look-switch-note';
  note.textContent = `${lookOf(current).blurb} Tap for the next look (restarts the run).`;
  root.append(button, note);
  return root;
}
