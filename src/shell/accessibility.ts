/**
 * src/shell/accessibility.ts
 * ═══════════════════════════════════════════════════════════════════════
 * Accessibility helpers: colorblind CSS filters, reduced-motion mode,
 * and an ARIA live region for screen-reader announcements.
 *
 * Reads from the Settings singleton so the correct preferences are
 * applied as soon as `init()` is called.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { Settings } from './settings';
import type { GameSettings } from './settings';

/* ─── Colorblind filter definitions ───────────────────────────────── */

/**
 * SVG-based CSS `filter` strings for each colorblind mode.
 * Using SVG feColorMatrix gives perceptually accurate results without
 * a WebGL post-process pass.
 */
const COLORBLIND_FILTERS: Record<
  GameSettings['colorblindMode'],
  string
> = {
  none: 'none',

  // Deuteranopia — red-green (green-weak)
  deuteranopia: [
    'url("data:image/svg+xml,',
    '<svg xmlns=\'http://www.w3.org/2000/svg\'><defs>',
    '<filter id=\'cb\'>',
    '<feColorMatrix type=\'matrix\' values=\'',
    '0.625 0.375 0   0 0 ',
    '0.7   0.3   0   0 0 ',
    '0     0.3   0.7 0 0 ',
    '0     0     0   1 0',
    '\'/></filter></defs></svg>#cb")',
  ].join(''),

  // Protanopia — red-green (red-weak)
  protanopia: [
    'url("data:image/svg+xml,',
    '<svg xmlns=\'http://www.w3.org/2000/svg\'><defs>',
    '<filter id=\'cb\'>',
    '<feColorMatrix type=\'matrix\' values=\'',
    '0.567 0.433 0     0 0 ',
    '0.558 0.442 0     0 0 ',
    '0     0.242 0.758 0 0 ',
    '0     0     0     1 0',
    '\'/></filter></defs></svg>#cb")',
  ].join(''),

  // Tritanopia — blue-yellow
  tritanopia: [
    'url("data:image/svg+xml,',
    '<svg xmlns=\'http://www.w3.org/2000/svg\'><defs>',
    '<filter id=\'cb\'>',
    '<feColorMatrix type=\'matrix\' values=\'',
    '0.95  0.05  0    0 0 ',
    '0     0.433 0.567 0 0 ',
    '0     0.475 0.525 0 0 ',
    '0     0     0     1 0',
    '\'/></filter></defs></svg>#cb")',
  ].join(''),
};

/* ═══════════════════════════════════════════════════════════════════
 * AccessibilityManager
 * ═══════════════════════════════════════════════════════════════════ */

class AccessibilityManager {
  private liveRegion: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;

  /**
   * Initialise accessibility features based on the current Settings.
   * Must be called once the DOM and canvas are ready.
   *
   * Sets up:
   * - Colorblind CSS filter on the canvas
   * - `prefers-reduced-motion`-style class on `<body>` when enabled
   * - ARIA live region injected into the document
   *
   * @param canvas - The main game canvas element
   */
  init(canvas?: HTMLCanvasElement): void {
    if (canvas) this.canvas = canvas;

    this.setupLiveRegion();
    this.applyColorblindFilter(
      this.canvas,
      Settings.get('colorblindMode')
    );
    this.applyReducedMotion(Settings.get('reducedMotion'));
  }

  /**
   * Apply a colorblind correction CSS filter to a canvas element.
   * Pass `null` as the canvas to clear any previously stored reference
   * without applying changes to the DOM.
   *
   * @param canvas - The canvas to filter, or null to no-op
   * @param mode   - The colorblind simulation/correction mode
   */
  applyColorblindFilter(
    canvas: HTMLCanvasElement | null | undefined,
    mode: GameSettings['colorblindMode']
  ): void {
    if (!canvas) return;
    canvas.style.filter = COLORBLIND_FILTERS[mode] ?? 'none';
  }

  /**
   * Enable or disable reduced-motion mode.
   *
   * When enabled:
   * - Adds the `reduced-motion` class to `<body>` (CSS can hook into this)
   * - Fires a `reducedMotion:change` CustomEvent so animation systems
   *   can lower particle counts and skip non-essential tweens.
   *
   * @param enabled - Whether reduced motion should be active
   */
  applyReducedMotion(enabled: boolean): void {
    if (typeof document === 'undefined') return;

    document.body.classList.toggle('reduced-motion', enabled);

    const event = new CustomEvent('reducedMotion:change', {
      detail: { enabled },
      bubbles: false,
    });
    window.dispatchEvent(event);
  }

  /**
   * Push a message to the ARIA live region so screen readers announce it.
   * Suitable for kill-feed entries, low-health warnings, round results, etc.
   *
   * @param text - Plain-text announcement string
   */
  announce(text: string): void {
    if (!this.liveRegion) this.setupLiveRegion();
    if (!this.liveRegion) return;

    // Clear then set forces re-announcement of repeated identical strings
    this.liveRegion.textContent = '';
    // Allow one frame for the DOM to flush the empty string
    requestAnimationFrame(() => {
      if (this.liveRegion) this.liveRegion.textContent = text;
    });
  }

  /**
   * Refresh all active accessibility settings from the Settings singleton.
   * Call after the player changes options in the settings menu.
   */
  refresh(): void {
    this.applyColorblindFilter(this.canvas, Settings.get('colorblindMode'));
    this.applyReducedMotion(Settings.get('reducedMotion'));
  }

  /* ─── Private helpers ──────────────────────────────────────────── */

  private setupLiveRegion(): void {
    if (typeof document === 'undefined') return;
    if (this.liveRegion) return;

    const region = document.createElement('div');
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');

    // Visually hidden but present in the accessibility tree
    Object.assign(region.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0,0,0,0)',
      whiteSpace: 'nowrap',
      border: '0',
    });

    document.body.appendChild(region);
    this.liveRegion = region;
  }
}

/* ─── Singleton ────────────────────────────────────────────────────── */

export const Accessibility = new AccessibilityManager();
