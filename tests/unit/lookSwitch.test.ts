import { describe, expect, it } from 'vitest';
import { LOOKS, nextLook } from '../../src/render/look';
import { lookLabel, makeLookSwitch } from '../../src/ui/lookSwitch';

/** Just enough of an element: children, text, a click that can be fired. */
class FakeEl {
  className = '';
  textContent = '';
  type = '';
  readonly children: FakeEl[] = [];
  private onClick: (() => void) | null = null;
  append(...c: FakeEl[]): void {
    this.children.push(...c);
  }
  addEventListener(type: string, fn: () => void): void {
    if (type === 'click') this.onClick = fn;
  }
  click(): void {
    this.onClick?.();
  }
}

const doc = { createElement: () => new FakeEl() } as unknown as Document;

describe('the look switch', () => {
  it('names the look in use and where it is in the list', () => {
    expect(lookLabel('night')).toBe(`LOOK 1/${LOOKS.length}: NIGHT BOWL`);
    expect(lookLabel(LOOKS[2].id)).toBe(`LOOK 3/${LOOKS.length}: ${LOOKS[2].name}`);
  });

  it('a tap asks for the next look and says the run restarts', () => {
    const asked: string[] = [];
    const el = makeLookSwitch(doc, 'pool', (id) => asked.push(id)) as unknown as FakeEl;
    const [button, note] = el.children;
    expect(button.textContent).toBe(lookLabel('pool'));
    expect(note.textContent).toContain('restarts the run');
    button.click();
    expect(asked).toEqual([nextLook('pool')]);
  });
});
