/**
 * src/shell/performance.ts
 * ═══════════════════════════════════════════════════════════════════════
 * Frame budget monitor. Tracks a rolling FPS window and emits a
 * 'quality:downgrade' CustomEvent on the window object when sustained
 * low frame rates are detected, allowing other systems to respond.
 * ═══════════════════════════════════════════════════════════════════════
 */

const WINDOW_SIZE = 30;       // rolling sample count
const LOW_FPS_THRESHOLD = 30; // frames per second
const LOW_FPS_FRAMES = 60;    // consecutive frames below threshold before event

/* ═══════════════════════════════════════════════════════════════════
 * PerformanceMonitor
 * ═══════════════════════════════════════════════════════════════════ */

class PerformanceMonitor {
  private samples: number[] = [];
  private sampleIndex = 0;
  private smoothedFPS = 60;
  private lowFrameCount = 0;
  private downgradeFired = false;

  /**
   * Record a frame and update the smoothed FPS average.
   * Must be called once per animation frame with the delta time.
   * @param dt - Delta time in seconds for the current frame
   */
  tick(dt: number): void {
    const fps = dt > 0 ? 1 / dt : 60;

    // Write into the circular buffer
    this.samples[this.sampleIndex % WINDOW_SIZE] = fps;
    this.sampleIndex++;

    const sampleCount = Math.min(this.sampleIndex, WINDOW_SIZE);
    let sum = 0;
    for (let i = 0; i < sampleCount; i++) {
      sum += this.samples[i];
    }
    this.smoothedFPS = sum / sampleCount;

    // Auto-quality downgrade detection
    if (this.smoothedFPS < LOW_FPS_THRESHOLD) {
      this.lowFrameCount++;
      if (this.lowFrameCount >= LOW_FPS_FRAMES && !this.downgradeFired) {
        this.downgradeFired = true;
        this.emitDowngrade();
      }
    } else {
      this.lowFrameCount = 0;
      this.downgradeFired = false;
    }
  }

  /**
   * Return the current smoothed frames-per-second value.
   * Averaged over a rolling window of the last 30 samples.
   */
  getFPS(): number {
    return this.smoothedFPS;
  }

  /**
   * Reset the monitor state (e.g. after a quality setting change).
   */
  reset(): void {
    this.samples = [];
    this.sampleIndex = 0;
    this.smoothedFPS = 60;
    this.lowFrameCount = 0;
    this.downgradeFired = false;
  }

  private emitDowngrade(): void {
    const event = new CustomEvent('quality:downgrade', {
      detail: { fps: this.smoothedFPS },
      bubbles: false,
    });
    window.dispatchEvent(event);
  }
}

/* ─── Singleton ────────────────────────────────────────────────────── */

export const Performance = new PerformanceMonitor();
