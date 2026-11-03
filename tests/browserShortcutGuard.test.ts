import { describe, expect, it } from 'vitest';
import { shouldCaptureBrowserShortcut } from '../shared/browserShortcuts';

describe('browser shortcut guard', () => {
  it('captures common browser navigation and UI shortcuts', () => {
    for (const key of ['r', 'f', 's', 'p', 'w', 't', 'n', 'l', 'u', 'a', 'd', 'e', 'g']) {
      expect(shouldCaptureBrowserShortcut({ key, ctrlKey: true })).toBe(true);
    }
    expect(shouldCaptureBrowserShortcut({ key: 'ф', code: 'KeyA', ctrlKey: true })).toBe(true);
    expect(shouldCaptureBrowserShortcut({ key: 'в', code: 'KeyD', ctrlKey: true })).toBe(true);
    expect(shouldCaptureBrowserShortcut({ key: 'ц', code: 'KeyW', ctrlKey: true })).toBe(true);
    expect(shouldCaptureBrowserShortcut({ key: '1', ctrlKey: true })).toBe(true);
    expect(shouldCaptureBrowserShortcut({ key: 'Tab', ctrlKey: true })).toBe(true);
    expect(shouldCaptureBrowserShortcut({ key: 'ArrowLeft', altKey: true })).toBe(true);
  });

  it('captures reload, focus, and page-scroll keys without modifiers', () => {
    expect(shouldCaptureBrowserShortcut({ key: 'F5' })).toBe(true);
    expect(shouldCaptureBrowserShortcut({ key: 'Tab' })).toBe(true);
    expect(shouldCaptureBrowserShortcut({ key: 'Backspace' })).toBe(true);
    expect(shouldCaptureBrowserShortcut({ key: ' ', code: 'Space' })).toBe(true);
  });

  it('keeps game keys, escape, fullscreen, and devtools available', () => {
    expect(shouldCaptureBrowserShortcut({ key: 'w' })).toBe(false);
    expect(shouldCaptureBrowserShortcut({ key: 'Escape' })).toBe(false);
    expect(shouldCaptureBrowserShortcut({ key: 'F11' })).toBe(false);
    expect(shouldCaptureBrowserShortcut({ key: 'F12' })).toBe(false);
    expect(shouldCaptureBrowserShortcut({ key: 'i', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(shouldCaptureBrowserShortcut({ key: 'j', ctrlKey: true, shiftKey: true })).toBe(false);
  });
});
