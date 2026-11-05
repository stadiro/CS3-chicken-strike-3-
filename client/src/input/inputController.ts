import { clamp } from '../../../shared/math';
import type { InputFrame } from '../../../shared/protocol';
import type { WeaponSlot } from '../../../shared/weapons';

const MOUSE_SENSITIVITY = 0.00215;
const PITCH_LIMIT = Math.PI / 2 - 0.01;
const ACTION_KEYS = new Set([
  'Space',
  'KeyR',
  'KeyE',
  'KeyF',
  'KeyG',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
]);

const GAMEPLAY_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'KeyC',
  'KeyR',
  'KeyE',
  'KeyF',
  'KeyG',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Tab',
]);

export interface InputControllerOptions {
  onPointerLockChange?: (locked: boolean) => void;
  onActivity?: () => void;
  onAction?: () => void;
  onSecondary?: (down: boolean) => void;
  /** Left mouse button pressed (used to cycle spectator targets). */
  onPrimary?: () => void;
  /** Inspect weapon requested. */
  onInspect?: () => void;
}

export class InputController {
  yaw = 0;
  pitch = 0;

  private readonly keys = new Set<string>();
  private fireHeld = false;
  private jumpQueued = false;
  private reloadQueued = false;
  private useQueued = false;
  private dropQueued = false;
  private switchQueued: WeaponSlot | null = null;
  private sequence = 0;
  private enabled = false;
  private disposed = false;
  private sensitivityMultiplier = 1;
  private toggleWalk = false;
  private walkToggled = false;
  private toggleScope = true;

  constructor(
    private readonly element: HTMLCanvasElement,
    private readonly options: InputControllerOptions = {},
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.element.addEventListener('click', this.onCanvasClick);
    this.element.addEventListener('contextmenu', this.onContextMenu);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keys.clear();
      this.fireHeld = false;
      this.jumpQueued = false;
      this.reloadQueued = false;
      this.useQueued = false;
      this.dropQueued = false;
      this.switchQueued = null;
      this.walkToggled = false;
    }
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  setSensitivityMultiplier(multiplier: number): void {
    this.sensitivityMultiplier = clamp(multiplier, 0.1, 3);
  }

  setToggleWalk(enabled: boolean): void {
    if (this.toggleWalk !== enabled) {
      this.toggleWalk = enabled;
      this.walkToggled = false;
    }
  }

  setToggleScope(enabled: boolean): void {
    this.toggleScope = enabled;
  }

  isToggleScope(): boolean {
    return this.toggleScope;
  }

  requestPointerLock(): void {
    if (document.pointerLockElement === this.element) {
      return;
    }
    try {
      void this.element.requestPointerLock().catch(() => {
        // Pointer lock can be rejected when the browser requires a direct user gesture
        // or the user denies the request. The pause overlay remains available.
      });
    } catch {
      // Some browsers throw synchronously when pointer lock is unavailable.
    }
  }

  releasePointerLock(): void {
    if (document.pointerLockElement === this.element) {
      document.exitPointerLock();
    }
  }

  isPointerLocked(): boolean {
    return document.pointerLockElement === this.element;
  }

  isMoving(): boolean {
    return (
      this.enabled &&
      (this.keys.has('KeyW') ||
        this.keys.has('KeyA') ||
        this.keys.has('KeyS') ||
        this.keys.has('KeyD'))
    );
  }

  isFiring(): boolean {
    return this.enabled && this.fireHeld;
  }

  isCrouching(): boolean {
    return (
      this.enabled &&
      (this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC'))
    );
  }

  isWalking(): boolean {
    if (!this.enabled) {
      return false;
    }
    if (this.toggleWalk) {
      return this.walkToggled;
    }
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  buildFrame(clientTime: number, scoped = false, aimTime = clientTime): InputFrame {
    const active = this.enabled;
    const forward =
      (active && this.keys.has('KeyW') ? 1 : 0) - (active && this.keys.has('KeyS') ? 1 : 0);
    const strafe =
      (active && this.keys.has('KeyD') ? 1 : 0) - (active && this.keys.has('KeyA') ? 1 : 0);

    const frame: InputFrame = {
      seq: (this.sequence += 1),
      clientTime,
      aimTime,
      forward,
      strafe,
      yaw: this.yaw,
      pitch: this.pitch,
      jump: active && this.jumpQueued,
      crouch: active && this.isCrouching(),
      walk: active && this.isWalking(),
      fire: active && this.fireHeld,
      scoped: active && scoped,
      reload: active && this.reloadQueued,
      use: active && this.useQueued,
      useHeld: active && this.keys.has('KeyE'),
      drop: active && this.dropQueued,
      switchTo: active ? this.switchQueued : null,
    };

    this.jumpQueued = false;
    this.reloadQueued = false;
    this.useQueued = false;
    this.dropQueued = false;
    this.switchQueued = null;
    return frame;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.element.removeEventListener('click', this.onCanvasClick);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) {
      return;
    }

    if (GAMEPLAY_CODES.has(event.code) || event.ctrlKey) {
      event.preventDefault();
    }

    if (event.repeat) {
      return;
    }

    // Ignore OS-level Meta/Alt chords, but NEVER ignore Ctrl chords because
    // ControlLeft / ControlRight is the gameplay crouch key!
    if (event.altKey || event.metaKey) {
      return;
    }

    if (this.toggleWalk && (event.code === 'ShiftLeft' || event.code === 'ShiftRight')) {
      this.walkToggled = !this.walkToggled;
      return;
    }

    this.keys.add(event.code);
    if (event.code === 'Space') {
      this.jumpQueued = true;
    } else if (event.code === 'KeyR') {
      this.reloadQueued = true;
    } else if (event.code === 'KeyE') {
      this.useQueued = true;
    } else if (event.code === 'KeyF') {
      this.options.onInspect?.();
    } else if (event.code === 'KeyG') {
      this.dropQueued = true;
    } else if (event.code === 'Digit1') {
      this.switchQueued = 'primary';
    } else if (event.code === 'Digit2') {
      this.switchQueued = 'secondary';
    } else if (event.code === 'Digit3') {
      this.switchQueued = 'knife';
    } else if (event.code === 'Digit4') {
      this.switchQueued = 'grenade';
    }

    // Send action frames immediately instead of waiting for the next render
    // tick. The server also queues these actions, so a fast 1→2→R sequence
    // cannot be overwritten by a later idle frame.
    if (ACTION_KEYS.has(event.code)) {
      this.options.onAction?.();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const hadKey = this.keys.delete(event.code);
    if (hadKey && event.code === 'KeyE') {
      this.options.onAction?.();
    }
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.enabled || !this.isPointerLocked()) {
      return;
    }

    const sensitivity = MOUSE_SENSITIVITY * this.sensitivityMultiplier;
    this.yaw -= event.movementX * sensitivity;
    this.pitch = clamp(this.pitch - event.movementY * sensitivity, -PITCH_LIMIT, PITCH_LIMIT);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.enabled || !this.isPointerLocked()) {
      return;
    }
    if (event.button === 2) {
      event.preventDefault();
      this.options.onSecondary?.(true);
      return;
    }
    if (event.button !== 0) {
      return;
    }
    this.fireHeld = true;
    this.options.onActivity?.();
    this.options.onPrimary?.();
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) {
      this.fireHeld = false;
    } else if (event.button === 2) {
      this.options.onSecondary?.(false);
    }
  };

  private readonly onCanvasClick = (): void => {
    if (!this.enabled) {
      return;
    }
    this.options.onActivity?.();
    this.requestPointerLock();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onPointerLockChange = (): void => {
    const locked = this.isPointerLocked();
    if (!locked) {
      this.keys.clear();
      this.fireHeld = false;
      this.options.onSecondary?.(false);
    }
    this.options.onPointerLockChange?.(locked);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.fireHeld = false;
    this.options.onSecondary?.(false);
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.keys.clear();
      this.fireHeld = false;
      this.options.onSecondary?.(false);
    }
  };
}
