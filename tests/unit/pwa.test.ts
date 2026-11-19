import { describe, expect, it } from 'vitest';
import { isUpdateWaiting, shouldRegisterSw, shouldReloadOnControllerChange } from '../../src/app/pwa';

describe('shouldRegisterSw', () => {
  it('registers only in a production build in a browser that supports workers', () => {
    expect(shouldRegisterSw(true, true)).toBe(true);
    expect(shouldRegisterSw(false, true)).toBe(false);
    expect(shouldRegisterSw(true, false)).toBe(false);
    expect(shouldRegisterSw(false, false)).toBe(false);
  });
});

describe('isUpdateWaiting', () => {
  it('offers an update when a worker finished installing under a controlling one', () => {
    expect(isUpdateWaiting('installed', true)).toBe(true);
  });

  it('offers nothing on the first install, when no worker controls the page yet', () => {
    expect(isUpdateWaiting('installed', false)).toBe(false);
  });

  it('offers nothing while the worker is still installing or after it has activated', () => {
    for (const state of ['parsed', 'installing', 'activating', 'activated', 'redundant']) {
      expect(isUpdateWaiting(state, true)).toBe(false);
    }
  });
});

describe('shouldReloadOnControllerChange', () => {
  it('reloads once after the player asked for the update', () => {
    expect(shouldReloadOnControllerChange(true, false)).toBe(true);
    expect(shouldReloadOnControllerChange(true, true)).toBe(false);
  });

  it('never reloads a page whose player did not ask (the first worker claiming the page)', () => {
    expect(shouldReloadOnControllerChange(false, false)).toBe(false);
  });
});
