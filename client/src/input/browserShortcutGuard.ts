import { shouldCaptureBrowserShortcut } from '../../../shared/browserShortcuts';

interface KeyboardLockApi {
  lock?: (keyCodes?: readonly string[]) => Promise<void>;
  unlock?: () => void;
}

interface NavigatorWithKeyboard extends Navigator {
  keyboard?: KeyboardLockApi;
}

const LOCKED_BROWSER_KEY_CODES: readonly string[] = [
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyN',
  'KeyT',
  'KeyR',
  'KeyE',
  'KeyF',
  'KeyG',
  'KeyH',
  'KeyJ',
  'KeyK',
  'KeyL',
  'KeyO',
  'KeyP',
  'KeyQ',
  'KeyU',
  'KeyB',
  'KeyC',
  'KeyM',
  'Tab',
  'Space',
  'Backspace',
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'Digit0',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
];

function lockSystemKeyboard(): void {
  const nav = navigator as NavigatorWithKeyboard;
  if (typeof nav.keyboard?.lock === 'function') {
    void nav.keyboard.lock(LOCKED_BROWSER_KEY_CODES).catch(() => {
      // Keyboard lock requires Fullscreen API in Chromium browsers; ignore rejection in windowed mode.
    });
  }
}

function unlockSystemKeyboard(): void {
  const nav = navigator as NavigatorWithKeyboard;
  if (typeof nav.keyboard?.unlock === 'function') {
    try {
      nav.keyboard.unlock();
    } catch {
      // Ignore if keyboard lock is unavailable.
    }
  }
}

function toggleGameFullscreen(): void {
  if (document.fullscreenElement === null) {
    if (typeof document.documentElement.requestFullscreen === 'function') {
      void document.documentElement
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() => {
          lockSystemKeyboard();
        })
        .catch(() => {
          // Ignore if blocked by browser policy.
        });
    }
  } else if (typeof document.exitFullscreen === 'function') {
    unlockSystemKeyboard();
    void document.exitFullscreen().catch(() => {
      // Ignore if already exited.
    });
  }
}

/**
 * Captures browser shortcuts while `isActive()` is true (or while in Fullscreen)
 * and uses the W3C Keyboard Lock API (`navigator.keyboard.lock`) on F11 Fullscreen
 * so reserved browser combinations like Ctrl+W, Ctrl+T, Ctrl+N do not close/leave the game.
 */
export function installBrowserShortcutGuard(isActive: () => boolean): () => void {
  let lastActiveAt = 0;

  const checkActive = (): boolean => {
    const active = isActive() || document.fullscreenElement !== null;
    if (active) {
      lastActiveAt = performance.now();
    }
    return active;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    // Intercept F11 to enter HTML5 Fullscreen + activate navigator.keyboard.lock(),
    // which allows Chromium browsers to block reserved shortcuts like Ctrl+W!
    if (
      (event.code === 'F11' || event.key === 'F11') &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      toggleGameFullscreen();
      return;
    }

    if (!checkActive() || event.defaultPrevented) {
      return;
    }

    const target = event.target;
    const isTyping =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;

    if (isTyping && !event.ctrlKey && !event.metaKey && !event.altKey) {
      return;
    }

    if (shouldCaptureBrowserShortcut(event)) {
      event.preventDefault();
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (!checkActive() || event.defaultPrevented) {
      return;
    }
    const target = event.target;
    const isTyping =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
    if (isTyping && !event.ctrlKey && !event.metaKey && !event.altKey) {
      return;
    }
    if (shouldCaptureBrowserShortcut(event)) {
      event.preventDefault();
    }
  };

  const onFullscreenChange = (): void => {
    if (document.fullscreenElement !== null) {
      lockSystemKeyboard();
    } else {
      unlockSystemKeyboard();
    }
  };

  const onPointerLockChange = (): void => {
    if (isActive()) {
      lastActiveAt = performance.now();
      lockSystemKeyboard();
    }
  };

  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (checkActive() || performance.now() - lastActiveAt < 1500) {
      event.preventDefault();
      event.returnValue = '';
    }
  };

  const onWheel = (event: WheelEvent): void => {
    if (checkActive() && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
    }
  };

  const onMouseDown = (event: MouseEvent): void => {
    if (checkActive() && (event.button === 1 || event.button === 3 || event.button === 4)) {
      event.preventDefault();
    }
  };

  const onAuxClick = (event: MouseEvent): void => {
    if (checkActive() && (event.button === 1 || event.button === 3 || event.button === 4)) {
      event.preventDefault();
    }
  };

  const onDragStart = (event: DragEvent): void => {
    if (checkActive()) {
      event.preventDefault();
    }
  };

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('auxclick', onAuxClick, true);
  window.addEventListener('dragstart', onDragStart, true);

  return () => {
    unlockSystemKeyboard();
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('auxclick', onAuxClick, true);
    window.removeEventListener('dragstart', onDragStart, true);
  };
}
