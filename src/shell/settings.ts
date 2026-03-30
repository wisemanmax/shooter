/**
 * src/shell/settings.ts
 * ═══════════════════════════════════════════════════════════════════════
 * Game settings persistence via localStorage. Provides typed access to
 * all user-configurable options and survives page reloads.
 * ═══════════════════════════════════════════════════════════════════════
 */

const STORAGE_KEY = 'shooter_settings';

/* ─── Public types ─────────────────────────────────────────────────── */

export interface GameSettings {
  sensitivity: number;
  fov: number;
  masterVolume: number;
  sfxVolume: number;
  uiVolume: number;
  quality: 'low' | 'medium' | 'high';
  reducedMotion: boolean;
  colorblindMode: 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia';
}

/* ─── Defaults ─────────────────────────────────────────────────────── */

export const DEFAULT_SETTINGS: Readonly<GameSettings> = {
  sensitivity: 0.002,
  fov: 90,
  masterVolume: 0.5,
  sfxVolume: 0.7,
  uiVolume: 0.5,
  quality: 'medium',
  reducedMotion: false,
  colorblindMode: 'none',
};

/* ─── Persistence helpers ──────────────────────────────────────────── */

/**
 * Load settings from localStorage, merging with defaults for any
 * keys that are missing (e.g. newly added settings after a version bump).
 * @returns A fully-populated GameSettings object
 */
export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Persist settings to localStorage.
 * @param settings - The settings object to save
 */
export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable in certain sandboxed environments
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * Settings singleton
 * ═══════════════════════════════════════════════════════════════════ */

class SettingsManager {
  private current: GameSettings;

  constructor() {
    this.current = loadSettings();
  }

  /**
   * Return the current value for a single setting key.
   * @param key - The setting key to retrieve
   */
  get<K extends keyof GameSettings>(key: K): GameSettings[K] {
    return this.current[key];
  }

  /**
   * Update one or more settings and immediately persist them.
   * @param patch - Partial settings object with keys to update
   */
  set(patch: Partial<GameSettings>): void {
    this.current = { ...this.current, ...patch };
    saveSettings(this.current);
  }

  /**
   * Return a shallow copy of all current settings.
   */
  getAll(): GameSettings {
    return { ...this.current };
  }

  /**
   * Reset all settings to defaults and persist.
   */
  reset(): void {
    this.current = { ...DEFAULT_SETTINGS };
    saveSettings(this.current);
  }
}

/* ─── Singleton ────────────────────────────────────────────────────── */

export const Settings = new SettingsManager();
