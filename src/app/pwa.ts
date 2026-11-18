/**
 * PWA glue: registers the service worker (dist/sw.js, made by scripts/make-sw.mjs) and offers
 * updates. Only a production build registers it (`__SHMOOVE_BUILD__`), so the dev server and the
 * unit tests never run a worker.
 *
 * A new worker installs in the background and waits. When it is waiting, a small bar at the bottom
 * edge says "New version: tap to update"; a tap posts 'skipWaiting' to it and the page reloads once
 * the new worker controls it.
 */

/** Whether to register the worker: a production build in a browser that has service workers. */
export function shouldRegisterSw(production: boolean, supported: boolean): boolean {
  return production && supported;
}

/**
 * Whether a worker in this state is an update waiting to take over. With no controller this is the
 * first install, not an update, and nothing should be offered.
 */
export function isUpdateWaiting(workerState: string, hasController: boolean): boolean {
  return workerState === 'installed' && hasController;
}

/** Reload when the controller changes only if the player asked for the update, and only once. */
export function shouldReloadOnControllerChange(updateRequested: boolean, alreadyReloading: boolean): boolean {
  return updateRequested && !alreadyReloading;
}

/** The text on the update bar. */
export const UPDATE_BAR_TEXT = 'New version: tap to update';

const BAR_BACKGROUND = '#ffd23f';
const BAR_TEXT_COLOUR = '#1b1630';

/** The bar's attribute, for tests and styling hooks. */
export const UPDATE_BAR_ATTR = 'data-pwa';
export const UPDATE_BAR_VALUE = 'update';

function makeUpdateBar(onTap: () => void): HTMLElement {
  const bar = document.createElement('button');
  bar.type = 'button';
  bar.setAttribute(UPDATE_BAR_ATTR, UPDATE_BAR_VALUE);
  bar.textContent = UPDATE_BAR_TEXT;
  const s = bar.style;
  s.position = 'fixed';
  s.left = '0';
  s.right = '0';
  s.bottom = '0';
  s.zIndex = '1000';
  s.boxSizing = 'border-box';
  s.margin = '0';
  s.border = '0';
  s.padding = '14px 16px';
  s.paddingBottom = 'calc(14px + env(safe-area-inset-bottom, 0px))';
  s.paddingLeft = 'calc(16px + env(safe-area-inset-left, 0px))';
  s.paddingRight = 'calc(16px + env(safe-area-inset-right, 0px))';
  s.background = BAR_BACKGROUND;
  s.color = BAR_TEXT_COLOUR;
  s.font = '700 16px/1.2 system-ui, sans-serif';
  s.textAlign = 'center';
  s.touchAction = 'manipulation';
  s.cursor = 'pointer';
  bar.addEventListener('click', onTap);
  return bar;
}

/** Register the worker and wire the update bar. Does nothing outside a production build. */
export function registerPwa(): void {
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  if (!shouldRegisterSw(__SHMOOVE_BUILD__, supported)) return;
  const sw = navigator.serviceWorker;

  let waiting: ServiceWorker | null = null;
  let bar: HTMLElement | null = null;
  let updateRequested = false;
  let reloading = false;

  const offer = (w: ServiceWorker): void => {
    waiting = w;
    if (bar) return;
    bar = makeUpdateBar(() => {
      updateRequested = true;
      waiting?.postMessage('skipWaiting');
    });
    document.body.appendChild(bar);
  };

  const track = (w: ServiceWorker | null): void => {
    if (!w) return;
    const check = (): void => {
      if (isUpdateWaiting(w.state, sw.controller !== null)) offer(w);
    };
    w.addEventListener('statechange', check);
    check();
  };

  sw.addEventListener('controllerchange', () => {
    if (!shouldReloadOnControllerChange(updateRequested, reloading)) return;
    reloading = true;
    window.location.reload();
  });

  const register = (): void => {
    sw.register('./sw.js')
      .then((reg) => {
        if (reg.waiting && sw.controller) offer(reg.waiting);
        reg.addEventListener('updatefound', () => track(reg.installing));
        track(reg.installing);
        // A phone app is rarely reloaded: look for a new version whenever it comes back to the front.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => undefined);
        });
      })
      .catch(() => {
        // No worker: the game still runs, only offline play is lost.
      });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
