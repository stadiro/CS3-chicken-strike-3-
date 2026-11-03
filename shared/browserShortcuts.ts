export interface ShortcutEventLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const FUNCTION_SHORTCUT_KEYS = new Set([
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
]);

const DEVTOOLS_KEYS = new Set(['i', 'j', 'c']);
const DEVTOOLS_CODES = new Set(['keyi', 'keyj', 'keyc']);

/**
 * Returns true when the browser default action should be suppressed while the
 * game owns keyboard input. Game keys themselves are intentionally left alone:
 * this only covers browser navigation/UI shortcuts.
 *
 * F11 (fullscreen), F12 and Ctrl+Shift+I/J/C (devtools) stay available on
 * purpose so the page remains debuggable.
 */
export function shouldCaptureBrowserShortcut(event: ShortcutEventLike): boolean {
  const key = event.key.toLowerCase();
  const code = (event.code ?? '').toLowerCase();
  if (key === 'escape' || key === 'f11' || key === 'f12') {
    return false;
  }

  // While in-game, Ctrl is the crouch modifier, so every Ctrl/Meta combination
  // (regardless of EN/RU keyboard layout) must be captured except DevTools.
  if (event.ctrlKey === true || event.metaKey === true) {
    if (event.shiftKey === true && (DEVTOOLS_KEYS.has(key) || DEVTOOLS_CODES.has(code))) {
      return false;
    }
    return true;
  }

  if (event.altKey === true) {
    return true;
  }

  return (
    key === 'tab' ||
    code === 'tab' ||
    key === 'backspace' ||
    code === 'backspace' ||
    key === ' ' ||
    code === 'space' ||
    key === 'contextmenu' ||
    code === 'contextmenu' ||
    FUNCTION_SHORTCUT_KEYS.has(key) ||
    FUNCTION_SHORTCUT_KEYS.has(code)
  );
}
