/**
 * Menu screens — hero select, settings, match results.
 * Manages UI state transitions between menu panels.
 */

import { Audio } from '../shell/audio';

/* ── Hero definitions for the select screen ── */

export interface HeroCardData {
  id: string;
  name: string;
  role: string;
  icon: string;
  desc: string;
  tacName: string;
  ultName: string;
}

const HERO_CARDS: HeroCardData[] = [
  { id: 'forge', name: 'Forge', role: 'Assault', icon: '🔥', desc: 'Aggressive frontline fighter', tacName: 'Stim', ultName: 'Orbital Strike' },
  { id: 'wraith', name: 'Wraith', role: 'Skirmisher', icon: '👻', desc: 'Elusive repositioner with phase tech', tacName: 'Phase Walk', ultName: 'Dimensional Rift' },
  { id: 'seer', name: 'Seer', role: 'Recon', icon: '👁', desc: 'Micro-drone intel specialist', tacName: 'Focus Scan', ultName: 'Exhibit' },
  { id: 'lifeline', name: 'Lifeline', role: 'Support', icon: '✚', desc: 'Combat medic with healing tech', tacName: 'D.O.C. Drone', ultName: 'Care Package' },
  { id: 'catalyst', name: 'Catalyst', role: 'Controller', icon: '🛡', desc: 'Area denial with ferrofluid tech', tacName: 'Piercing Spikes', ultName: 'Ferro Wall' },
];

/* ── Cached DOM refs ── */

let mainMenu: HTMLElement | null = null;
let heroSelect: HTMLElement | null = null;
let settingsPanel: HTMLElement | null = null;
let matchResults: HTMLElement | null = null;

/** Callback when a hero is selected */
let onHeroSelected: ((heroId: string) => void) | null = null;
/** Callback when firing range is requested */
let onFiringRange: (() => void) | null = null;
/** Callback when play is requested */
let onPlay: (() => void) | null = null;
/** Callback when settings change */
let onSettingsChanged: ((settings: any) => void) | null = null;

/**
 * Initialize all menu systems. Call once after DOM ready.
 * @param callbacks - Event handlers for menu actions
 */
export function initMenus(callbacks: {
  onHeroSelected: (heroId: string) => void;
  onFiringRange: () => void;
  onPlay: () => void;
  onSettingsChanged?: (settings: any) => void;
}): void {
  onHeroSelected = callbacks.onHeroSelected;
  onFiringRange = callbacks.onFiringRange;
  onPlay = callbacks.onPlay;
  onSettingsChanged = callbacks.onSettingsChanged || null;

  mainMenu = document.getElementById('main-menu');
  heroSelect = document.getElementById('hero-select');
  settingsPanel = document.getElementById('settings-panel');
  matchResults = document.getElementById('match-results');

  // ── Build hero select grid ──
  const grid = document.getElementById('hero-grid')!;
  for (const h of HERO_CARDS) {
    const card = document.createElement('div');
    card.className = 'hero-card';
    card.dataset.hero = h.id;
    card.innerHTML = `<div class="hc-icon">${h.icon}</div><div class="hc-name">${h.name}</div><div class="hc-class">${h.role}</div><div class="hc-desc">${h.desc}</div><div class="hc-abil">Q: ${h.tacName} · Z: ${h.ultName}</div>`;
    card.addEventListener('click', () => {
      Audio.play('ui_confirm');
      if (onHeroSelected) onHeroSelected(h.id);
    });
    card.addEventListener('mouseenter', () => Audio.play('ui_hover'));
    grid.appendChild(card);
  }

  // ── Main menu buttons ──
  document.getElementById('btn-play')?.addEventListener('click', () => {
    Audio.play('ui_click');
    if (onPlay) onPlay();
  });
  document.getElementById('btn-firing-range')?.addEventListener('click', () => {
    Audio.play('ui_click');
    showHeroSelect();
    onHeroSelected = (heroId: string) => {
      hideHeroSelect();
      if (callbacks.onFiringRange) callbacks.onFiringRange();
      // Restore normal callback
      onHeroSelected = callbacks.onHeroSelected;
    };
  });
  document.getElementById('btn-private')?.addEventListener('click', () => {
    Audio.play('ui_click');
    // TODO: lobby UI
  });
  document.getElementById('btn-settings')?.addEventListener('click', () => {
    Audio.play('ui_click');
    showSettings();
  });

  // ── Build settings panel ──
  buildSettingsPanel();
}

/** Show the main menu */
export function showMainMenu(): void {
  mainMenu?.classList.remove('hidden');
  heroSelect?.classList.add('hidden');
  settingsPanel?.classList.add('hidden');
  matchResults?.classList.add('hidden');
}

/** Hide the main menu */
export function hideMainMenu(): void {
  mainMenu?.classList.add('hidden');
}

/** Show hero select screen */
export function showHeroSelect(): void {
  heroSelect?.classList.remove('hidden');
  mainMenu?.classList.add('hidden');
}

/** Hide hero select screen */
export function hideHeroSelect(): void {
  heroSelect?.classList.add('hidden');
}

/** Show settings panel */
export function showSettings(): void {
  settingsPanel?.classList.remove('hidden');
  mainMenu?.classList.add('hidden');
}

/** Hide settings panel */
export function hideSettings(): void {
  settingsPanel?.classList.add('hidden');
}

function buildSettingsPanel(): void {
  if (!settingsPanel) return;
  settingsPanel.innerHTML = `
    <h1>SETTINGS</h1>
    <div class="settings-group">
      <label>Sensitivity <span id="sens-val">0.002</span></label>
      <input type="range" id="set-sens" min="0.0005" max="0.005" step="0.0001" value="0.002">
    </div>
    <div class="settings-group">
      <label>FOV <span id="fov-val">90</span></label>
      <input type="range" id="set-fov" min="60" max="120" step="1" value="90">
    </div>
    <div class="settings-group">
      <label>Master Volume <span id="mvol-val">50</span></label>
      <input type="range" id="set-mvol" min="0" max="100" step="1" value="50">
    </div>
    <div class="settings-group">
      <label>SFX Volume <span id="svol-val">70</span></label>
      <input type="range" id="set-svol" min="0" max="100" step="1" value="70">
    </div>
    <button class="settings-back" id="settings-back">BACK</button>
  `;

  document.getElementById('settings-back')?.addEventListener('click', () => {
    Audio.play('ui_click');
    hideSettings();
    showMainMenu();
  });

  // Slider feedback
  const sensSlider = document.getElementById('set-sens') as HTMLInputElement;
  const fovSlider = document.getElementById('set-fov') as HTMLInputElement;
  const mvolSlider = document.getElementById('set-mvol') as HTMLInputElement;
  const svolSlider = document.getElementById('set-svol') as HTMLInputElement;

  sensSlider?.addEventListener('input', () => {
    document.getElementById('sens-val')!.textContent = sensSlider.value;
    emitSettings();
  });
  fovSlider?.addEventListener('input', () => {
    document.getElementById('fov-val')!.textContent = fovSlider.value;
    emitSettings();
  });
  mvolSlider?.addEventListener('input', () => {
    document.getElementById('mvol-val')!.textContent = mvolSlider.value;
    Audio.setVolume('master', +mvolSlider.value / 100);
    emitSettings();
  });
  svolSlider?.addEventListener('input', () => {
    document.getElementById('svol-val')!.textContent = svolSlider.value;
    Audio.setVolume('sfx', +svolSlider.value / 100);
    emitSettings();
  });

  function emitSettings(): void {
    if (onSettingsChanged) {
      onSettingsChanged({
        sensitivity: +sensSlider.value,
        fov: +fovSlider.value,
        masterVolume: +mvolSlider.value / 100,
        sfxVolume: +svolSlider.value / 100,
      });
    }
  }
}

/**
 * Show match results screen.
 * @param victory - Whether the player's squad won
 * @param stats - Post-match statistics
 */
export function showMatchResults(
  victory: boolean,
  stats: { kills: number; damage: number; survival: number; placement: number },
): void {
  if (!matchResults) return;
  matchResults.classList.remove('hidden');
  matchResults.innerHTML = `
    <h1>${victory ? 'VICTORY' : 'DEFEATED'}</h1>
    <div class="result-sub">${victory ? 'Champion Squad!' : 'Better luck next time'}</div>
    <div class="result-stats">
      <div class="result-stat"><div class="rs-val">${stats.kills}</div><div class="rs-lbl">Kills</div></div>
      <div class="result-stat"><div class="rs-val">${stats.damage}</div><div class="rs-lbl">Damage</div></div>
      <div class="result-stat"><div class="rs-val">${stats.survival}s</div><div class="rs-lbl">Survived</div></div>
      <div class="result-stat"><div class="rs-val">#${stats.placement}</div><div class="rs-lbl">Placement</div></div>
    </div>
    <button class="result-continue" id="result-continue">CONTINUE</button>
  `;
  document.getElementById('result-continue')?.addEventListener('click', () => {
    Audio.play('ui_click');
    matchResults?.classList.add('hidden');
    showMainMenu();
  });
}

/** Get hero card data by id */
export function getHeroCard(id: string): HeroCardData | undefined {
  return HERO_CARDS.find(h => h.id === id);
}
