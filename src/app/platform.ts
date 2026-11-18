/**
 * Phone plumbing: stop the browser gestures that fight a game, and keep the screen awake.
 *
 * Blocked: pinch and double-tap zoom, the context menu (long press), pull-to-refresh and page
 * scrolling, and text selection. The screen wake lock is taken on the first touch (it needs a user
 * gesture on some browsers) and taken again whenever the page becomes visible, since the browser
 * drops it when the page is hidden. Everything fails silently where it is unsupported.
 */

interface WakeLockSentinelLike {
  readonly released: boolean;
  addEventListener(type: 'release', cb: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

const prevent = (e: Event): void => {
  if (e.cancelable) e.preventDefault();
};

export function blockBrowserGestures(doc: Document = document): void {
  const root = doc.documentElement;
  root.style.touchAction = 'none';
  root.style.overscrollBehavior = 'none';
  root.style.userSelect = 'none';
  root.style.setProperty('-webkit-user-select', 'none');
  root.style.setProperty('-webkit-touch-callout', 'none');
  root.style.setProperty('-webkit-tap-highlight-color', 'transparent');

  const opts: AddEventListenerOptions = { passive: false };
  // Scrolling, pull-to-refresh and pinch all start as a touchmove; nothing in the game scrolls.
  doc.addEventListener('touchmove', prevent, opts);
  // A second finger landing is where pinch zoom starts.
  doc.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      if (e.touches.length > 1) prevent(e);
    },
    opts,
  );
  doc.addEventListener('dblclick', prevent, opts);
  doc.addEventListener('contextmenu', prevent, opts);
  doc.addEventListener('selectstart', prevent, opts);
  // Safari's own pinch events.
  doc.addEventListener('gesturestart', prevent, opts);
  doc.addEventListener('gesturechange', prevent, opts);
  doc.addEventListener('gestureend', prevent, opts);
}

/** Hold a screen wake lock from the first touch on, re-taking it when the page is shown again. */
export function keepScreenAwake(doc: Document = document, nav: Navigator = navigator): void {
  const wakeLock = (nav as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  if (!wakeLock || typeof wakeLock.request !== 'function') return;
  let wanted = false;
  let held: WakeLockSentinelLike | null = null;
  let pending = false;

  const acquire = (): void => {
    if (!wanted || pending || doc.visibilityState !== 'visible') return;
    if (held && !held.released) return;
    pending = true;
    let p: Promise<WakeLockSentinelLike>;
    try {
      p = wakeLock.request('screen');
    } catch (_e) {
      pending = false;
      return;
    }
    p.then(
      (sentinel) => {
        pending = false;
        held = sentinel;
        sentinel.addEventListener('release', () => {
          if (held === sentinel) held = null;
        });
      },
      () => {
        pending = false;
      },
    );
  };

  const first = (): void => {
    wanted = true;
    acquire();
  };
  doc.addEventListener('pointerdown', first, { passive: true });
  doc.addEventListener('touchstart', first, { passive: true });
  doc.addEventListener('visibilitychange', acquire);
}

export function setupPlatform(): void {
  blockBrowserGestures();
  keepScreenAwake();
}
