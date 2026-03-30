/**
 * src/shell/logger.ts
 * ═══════════════════════════════════════════════════════════════════════
 * Structured, timestamped logging with per-system prefixes.
 * Outputs to the browser console with appropriate log levels.
 * Format: [HH:MM:SS] [LEVEL] [system] message
 * ═══════════════════════════════════════════════════════════════════════
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/* ═══════════════════════════════════════════════════════════════════
 * GameLogger
 * ═══════════════════════════════════════════════════════════════════ */

class GameLogger {
  private minLevel: LogLevel = 'debug';

  private readonly levelOrder: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  /**
   * Set the minimum log level. Messages below this level are suppressed.
   * Useful for reducing noise in production builds.
   * @param level - Minimum level to output
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Emit a structured log message.
   * @param level   - Severity level
   * @param system  - The subsystem emitting the message (e.g. 'Combat', 'Net')
   * @param message - Human-readable description
   * @param data    - Optional extra data to print alongside the message
   */
  log(level: LogLevel, system: string, message: string, data?: unknown): void {
    if (this.levelOrder[level] < this.levelOrder[this.minLevel]) return;

    const timestamp = this.timestamp();
    const prefix = `[${timestamp}] [${level.toUpperCase().padEnd(5)}] [${system}]`;
    const formatted = `${prefix} ${message}`;

    switch (level) {
      case 'debug':
        data !== undefined ? console.debug(formatted, data) : console.debug(formatted);
        break;
      case 'info':
        data !== undefined ? console.info(formatted, data) : console.info(formatted);
        break;
      case 'warn':
        data !== undefined ? console.warn(formatted, data) : console.warn(formatted);
        break;
      case 'error':
        data !== undefined ? console.error(formatted, data) : console.error(formatted);
        break;
    }
  }

  /**
   * Log at 'debug' level.
   * @param system  - Subsystem name
   * @param message - Log message
   * @param data    - Optional attached data
   */
  debug(system: string, message: string, data?: unknown): void {
    this.log('debug', system, message, data);
  }

  /**
   * Log at 'info' level.
   * @param system  - Subsystem name
   * @param message - Log message
   * @param data    - Optional attached data
   */
  info(system: string, message: string, data?: unknown): void {
    this.log('info', system, message, data);
  }

  /**
   * Log at 'warn' level.
   * @param system  - Subsystem name
   * @param message - Log message
   * @param data    - Optional attached data
   */
  warn(system: string, message: string, data?: unknown): void {
    this.log('warn', system, message, data);
  }

  /**
   * Log at 'error' level.
   * @param system  - Subsystem name
   * @param message - Log message
   * @param err     - Optional Error object or extra data
   */
  error(system: string, message: string, err?: unknown): void {
    this.log('error', system, message, err);
  }

  private timestamp(): string {
    const now = new Date();
    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');
    const ss = now.getSeconds().toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
}

/* ─── Singleton ────────────────────────────────────────────────────── */

export const Logger = new GameLogger();
