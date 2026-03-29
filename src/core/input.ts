/**
 * Input Manager — extracted from v6 `I` object (line 476).
 * Tracks keyboard, mouse, and scroll state with rising-edge detection.
 */

export class InputManager {
  /** Current frame key states */
  private keys: Record<string, boolean> = {};
  /** Previous frame key states (for justPressed detection) */
  private prev: Record<string, boolean> = {};
  /** Accumulated mouse X movement since last consume */
  private mouseX = 0;
  /** Accumulated mouse Y movement since last consume */
  private mouseY = 0;
  /** Whether the left mouse button is currently held */
  mouseHeld = false;
  /** Whether pointer lock is active */
  locked = false;
  /** Mouse sensitivity multiplier (default from v6 C.SENS) */
  sensitivity = 0.002;
  /** Accumulated scroll wheel delta since last consume */
  private scrollAccum = 0;

  /** Initialize listeners on a canvas element */
  init(canvas: HTMLCanvasElement): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      this.keys[e.code] = true;
      if (e.code === 'Tab') e.preventDefault();
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.keys[e.code] = false;
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.locked) return;
      this.mouseX += e.movementX;
      this.mouseY += e.movementY;
    });

    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 0) this.mouseHeld = true;
    });

    canvas.addEventListener('mouseup', (e: MouseEvent) => {
      if (e.button === 0) this.mouseHeld = false;
    });

    window.addEventListener('wheel', (e: WheelEvent) => {
      this.scrollAccum += Math.sign(e.deltaY);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = !!document.pointerLockElement;
      if (!this.locked) this.mouseHeld = false;
    });

    canvas.addEventListener('click', () => {
      if (!this.locked) canvas.requestPointerLock();
    });
  }

  /** Consume accumulated mouse movement and reset accumulators */
  consumeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mouseX, dy: this.mouseY };
    this.mouseX = 0;
    this.mouseY = 0;
    return r;
  }

  /** Consume accumulated scroll delta and reset */
  consumeScroll(): number {
    const s = this.scrollAccum;
    this.scrollAccum = 0;
    return s;
  }

  /** Just pressed — true only on the frame the key transitions from up to down */
  justPressed(code: string): boolean {
    return !!this.keys[code] && !this.prev[code];
  }

  /** Currently held down */
  isDown(code: string): boolean {
    return !!this.keys[code];
  }

  /** Call at end of frame to snapshot current state into prev */
  endFrame(): void {
    this.prev = { ...this.keys };
  }

  // ── Convenience getters (matching v6 I object properties) ──

  /** W key — move forward */
  get forward(): boolean { return this.isDown('KeyW'); }
  /** S key — move backward */
  get backward(): boolean { return this.isDown('KeyS'); }
  /** A key — strafe left */
  get left(): boolean { return this.isDown('KeyA'); }
  /** D key — strafe right */
  get right(): boolean { return this.isDown('KeyD'); }
  /** Shift — sprint */
  get sprint(): boolean { return this.isDown('ShiftLeft') || this.isDown('ShiftRight'); }
  /** Ctrl — crouch */
  get crouch(): boolean { return this.isDown('ControlLeft') || this.isDown('ControlRight'); }
  /** Space — jump */
  get jump(): boolean { return this.isDown('Space'); }
  /** R — reload (rising edge) */
  get reload(): boolean { return this.justPressed('KeyR'); }
  /** E — interact (held) */
  get interact(): boolean { return this.isDown('KeyE'); }
  /** E — interact (rising edge) */
  get interactJustPressed(): boolean { return this.justPressed('KeyE'); }
  /** Left mouse + pointer lock — fire */
  get fire(): boolean { return this.mouseHeld && this.locked; }
  /** 1 — swap to weapon slot 1 (rising edge) */
  get swap1(): boolean { return this.justPressed('Digit1'); }
  /** 2 — swap to weapon slot 2 (rising edge) */
  get swap2(): boolean { return this.justPressed('Digit2'); }
  /** 3 — use consumable syringe (rising edge) */
  get useConsumable3(): boolean { return this.justPressed('Digit3'); }
  /** 4 — use consumable medkit (rising edge) */
  get useConsumable4(): boolean { return this.justPressed('Digit4'); }
  /** 5 — use consumable cell (rising edge) */
  get useConsumable5(): boolean { return this.justPressed('Digit5'); }
  /** 6 — use consumable battery (rising edge) */
  get useConsumable6(): boolean { return this.justPressed('Digit6'); }
  /** F — toggle door (rising edge) */
  get door(): boolean { return this.justPressed('KeyF'); }
  /** Q — tactical ability (rising edge) */
  get abilQ(): boolean { return this.justPressed('KeyQ'); }
  /** Z — ultimate ability (rising edge) */
  get abilZ(): boolean { return this.justPressed('KeyZ'); }
}

/** Global input manager singleton */
export const Input = new InputManager();
