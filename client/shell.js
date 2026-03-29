/**
 * client/shell.js — Production Shell Systems
 * ═══════════════════════════════════════════════════════════════════════
 * Import this module to wrap any Drop Zone game client with:
 *   - Audio synthesis (no external files needed)
 *   - Settings persistence (localStorage)
 *   - Accessibility (colorblind modes, screen-reader hints, reduced motion)
 *   - Performance monitoring (frame budget, GC detection, auto-quality)
 *   - Error boundary with structured logging
 *   - Tutorial / onboarding overlay system
 *   - VFX placeholder manager (particle pools, screen effects)
 *   - Animation transition system (UI screen fades, match intros)
 *
 * Usage:
 *   import { Shell } from './shell.js';
 *   Shell.init();                       // call once at startup
 *   Shell.Audio.play('fire_ar');        // in gameplay
 *   Shell.Perf.beginFrame();            // top of game loop
 *   Shell.Perf.endFrame();              // bottom of game loop
 *   Shell.Tutorial.show('movement');    // contextual hint
 * ═══════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════
//  AUDIO MANAGER — Web Audio API synthesis, no external files
// ═══════════════════════════════════════════════════════════════════
const Audio = (() => {
  let ctx = null;
  let masterGain = null;
  let sfxGain = null;
  let uiGain = null;
  let muted = false;
  const volumes = { master: 0.5, sfx: 0.7, ui: 0.5 };

  /** Sound definitions — synthesized on demand */
  const SOUNDS = {
    // Weapon fire (noise burst + pitch defines character)
    fire_ar:     { type: 'noise', dur: 0.08, freq: 200,  decay: 0.06, gain: 0.4 },
    fire_smg:    { type: 'noise', dur: 0.05, freq: 280,  decay: 0.04, gain: 0.35 },
    fire_sg:     { type: 'noise', dur: 0.12, freq: 140,  decay: 0.1,  gain: 0.5 },
    fire_mk:     { type: 'noise', dur: 0.1,  freq: 160,  decay: 0.08, gain: 0.45 },
    fire_ps:     { type: 'noise', dur: 0.06, freq: 320,  decay: 0.04, gain: 0.3 },
    fire_lmg:    { type: 'noise', dur: 0.07, freq: 180,  decay: 0.05, gain: 0.4 },

    // Impacts
    hit_shield:  { type: 'tone',  dur: 0.1,  freq: 800,  decay: 0.08, gain: 0.25, wave: 'sine' },
    hit_flesh:   { type: 'tone',  dur: 0.08, freq: 400,  decay: 0.06, gain: 0.3,  wave: 'sawtooth' },
    hit_head:    { type: 'tone',  dur: 0.12, freq: 1200, decay: 0.1,  gain: 0.3,  wave: 'sine' },
    shield_break:{ type: 'sweep', dur: 0.3,  freqStart: 1000, freqEnd: 200, gain: 0.35 },
    down:        { type: 'sweep', dur: 0.5,  freqStart: 600,  freqEnd: 100, gain: 0.3 },

    // Actions
    reload_start:{ type: 'tone',  dur: 0.15, freq: 500,  decay: 0.12, gain: 0.15, wave: 'triangle' },
    reload_end:  { type: 'tone',  dur: 0.1,  freq: 700,  decay: 0.08, gain: 0.2,  wave: 'triangle' },
    swap_weapon: { type: 'tone',  dur: 0.08, freq: 600,  decay: 0.06, gain: 0.15, wave: 'triangle' },
    pickup:      { type: 'tone',  dur: 0.12, freq: 900,  decay: 0.1,  gain: 0.2,  wave: 'sine' },
    consumable:  { type: 'sweep', dur: 0.4,  freqStart: 400, freqEnd: 800, gain: 0.2 },

    // Abilities
    ability_tac: { type: 'sweep', dur: 0.25, freqStart: 300, freqEnd: 900, gain: 0.25 },
    ability_ult: { type: 'sweep', dur: 0.5,  freqStart: 200, freqEnd: 1200, gain: 0.35 },

    // Traversal
    zip_start:   { type: 'tone',  dur: 0.2,  freq: 350,  decay: 0.15, gain: 0.2, wave: 'sawtooth' },
    pad_launch:  { type: 'sweep', dur: 0.3,  freqStart: 200, freqEnd: 800, gain: 0.3 },

    // UI
    ui_click:    { type: 'tone',  dur: 0.04, freq: 1000, decay: 0.03, gain: 0.1, wave: 'sine', bus: 'ui' },
    ui_hover:    { type: 'tone',  dur: 0.02, freq: 800,  decay: 0.015,gain: 0.05,wave: 'sine', bus: 'ui' },
    ui_error:    { type: 'tone',  dur: 0.15, freq: 200,  decay: 0.12, gain: 0.15,wave: 'sawtooth', bus: 'ui' },
    ui_confirm:  { type: 'sweep', dur: 0.15, freqStart: 600, freqEnd: 1000, gain: 0.12, bus: 'ui' },
    match_start: { type: 'sweep', dur: 0.8,  freqStart: 200, freqEnd: 600,  gain: 0.25 },
    kill_confirm:{ type: 'tone',  dur: 0.15, freq: 1400, decay: 0.12, gain: 0.2, wave: 'sine' },

    // Ring
    ring_warning:{ type: 'sweep', dur: 0.6,  freqStart: 800, freqEnd: 300, gain: 0.2 },
    ring_closing:{ type: 'tone',  dur: 0.3,  freq: 250,  decay: 0.25, gain: 0.15, wave: 'sawtooth' },
  };

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = volumes.master;
      masterGain.connect(ctx.destination);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = volumes.sfx;
      sfxGain.connect(masterGain);
      uiGain = ctx.createGain();
      uiGain.gain.value = volumes.ui;
      uiGain.connect(masterGain);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  return {
    SOUNDS,

    play(soundId) {
      if (muted) return;
      ensureCtx();
      const def = SOUNDS[soundId];
      if (!def) return;
      const dest = def.bus === 'ui' ? uiGain : sfxGain;
      const now = ctx.currentTime;

      if (def.type === 'noise') {
        // White noise burst filtered at freq
        const bufSize = Math.ceil(ctx.sampleRate * def.dur);
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = def.freq;
        const gain = ctx.createGain(); gain.gain.setValueAtTime(def.gain, now); gain.gain.exponentialRampToValueAtTime(0.001, now + def.decay);
        src.connect(filter); filter.connect(gain); gain.connect(dest);
        src.start(now); src.stop(now + def.dur);
      }
      else if (def.type === 'tone') {
        const osc = ctx.createOscillator(); osc.type = def.wave || 'sine'; osc.frequency.value = def.freq;
        const gain = ctx.createGain(); gain.gain.setValueAtTime(def.gain, now); gain.gain.exponentialRampToValueAtTime(0.001, now + def.decay);
        osc.connect(gain); gain.connect(dest);
        osc.start(now); osc.stop(now + def.dur);
      }
      else if (def.type === 'sweep') {
        const osc = ctx.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(def.freqStart, now);
        osc.frequency.exponentialRampToValueAtTime(def.freqEnd, now + def.dur);
        const gain = ctx.createGain(); gain.gain.setValueAtTime(def.gain, now); gain.gain.exponentialRampToValueAtTime(0.001, now + def.dur);
        osc.connect(gain); gain.connect(dest);
        osc.start(now); osc.stop(now + def.dur + 0.01);
      }
    },

    setVolume(bus, value) {
      volumes[bus] = Math.max(0, Math.min(1, value));
      if (bus === 'master' && masterGain) masterGain.gain.value = value;
      if (bus === 'sfx' && sfxGain) sfxGain.gain.value = value;
      if (bus === 'ui' && uiGain) uiGain.gain.value = value;
      Settings.save('audio', volumes);
    },

    getVolume(bus) { return volumes[bus]; },
    mute() { muted = true; if (masterGain) masterGain.gain.value = 0; },
    unmute() { muted = false; if (masterGain) masterGain.gain.value = volumes.master; },
    toggleMute() { muted ? this.unmute() : this.mute(); },
    isMuted() { return muted; },

    /** Restore volumes from saved settings */
    restore(saved) {
      if (saved) { Object.assign(volumes, saved); }
    },
  };
})();


// ═══════════════════════════════════════════════════════════════════
//  SETTINGS — Persistent config via localStorage
// ═══════════════════════════════════════════════════════════════════
const Settings = {
  _prefix: 'dz_',
  _cache: {},

  init() {
    // Load all settings from localStorage
    const keys = ['controls', 'audio', 'video', 'accessibility', 'tutorial'];
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(this._prefix + k);
        this._cache[k] = raw ? JSON.parse(raw) : null;
      } catch { this._cache[k] = null; }
    }
    // Apply defaults
    if (!this._cache.controls) this._cache.controls = { sensitivity: 1.0, fov: 90, invertY: false };
    if (!this._cache.audio) this._cache.audio = { master: 0.5, sfx: 0.7, ui: 0.5 };
    if (!this._cache.video) this._cache.video = { quality: 'medium', shadows: true, particles: true, fpsCounter: true };
    if (!this._cache.accessibility) this._cache.accessibility = { colorblindMode: 'none', reducedMotion: false, screenReaderHints: false, subtitles: false, fontSize: 'medium', highContrast: false };
    if (!this._cache.tutorial) this._cache.tutorial = { completed: [], skipped: false };

    Audio.restore(this._cache.audio);
  },

  get(category) { return this._cache[category] || {}; },

  set(category, key, value) {
    if (!this._cache[category]) this._cache[category] = {};
    this._cache[category][key] = value;
    this.save(category, this._cache[category]);
  },

  save(category, data) {
    this._cache[category] = data;
    try { localStorage.setItem(this._prefix + category, JSON.stringify(data)); } catch {}
  },

  /** Build a settings UI panel. Returns an HTML string. */
  buildPanel() {
    const c = this._cache;
    return `
      <div class="settings-panel" style="font-family:'JetBrains Mono',monospace;color:#aaa;font-size:.6rem;line-height:2.2">
        <h3 style="font-family:'Rajdhani',sans-serif;color:#e8c547;font-size:.85rem;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">SETTINGS</h3>

        <div style="color:#777;font-size:.5rem;letter-spacing:.08em;margin:8px 0 4px">CONTROLS</div>
        <label>Sensitivity <input type="range" min="0.2" max="5" step="0.1" value="${c.controls.sensitivity}" data-s="controls.sensitivity"> <span>${c.controls.sensitivity}</span></label><br>
        <label>FOV <input type="range" min="60" max="120" step="1" value="${c.controls.fov}" data-s="controls.fov"> <span>${c.controls.fov}</span></label><br>
        <label><input type="checkbox" ${c.controls.invertY?'checked':''} data-s="controls.invertY"> Invert Y</label><br>

        <div style="color:#777;font-size:.5rem;letter-spacing:.08em;margin:8px 0 4px">AUDIO</div>
        <label>Master <input type="range" min="0" max="1" step="0.05" value="${c.audio.master}" data-s="audio.master"> <span>${Math.round(c.audio.master*100)}%</span></label><br>
        <label>SFX <input type="range" min="0" max="1" step="0.05" value="${c.audio.sfx}" data-s="audio.sfx"> <span>${Math.round(c.audio.sfx*100)}%</span></label><br>
        <label>UI <input type="range" min="0" max="1" step="0.05" value="${c.audio.ui}" data-s="audio.ui"> <span>${Math.round(c.audio.ui*100)}%</span></label><br>

        <div style="color:#777;font-size:.5rem;letter-spacing:.08em;margin:8px 0 4px">VIDEO</div>
        <label>Shadows <input type="checkbox" ${c.video.shadows?'checked':''} data-s="video.shadows"></label>&nbsp;
        <label>Particles <input type="checkbox" ${c.video.particles?'checked':''} data-s="video.particles"></label>&nbsp;
        <label>FPS Counter <input type="checkbox" ${c.video.fpsCounter?'checked':''} data-s="video.fpsCounter"></label><br>

        <div style="color:#777;font-size:.5rem;letter-spacing:.08em;margin:8px 0 4px">ACCESSIBILITY</div>
        <label>Colorblind Mode <select data-s="accessibility.colorblindMode">
          <option value="none" ${c.accessibility.colorblindMode==='none'?'selected':''}>None</option>
          <option value="deuteranopia" ${c.accessibility.colorblindMode==='deuteranopia'?'selected':''}>Deuteranopia</option>
          <option value="protanopia" ${c.accessibility.colorblindMode==='protanopia'?'selected':''}>Protanopia</option>
          <option value="tritanopia" ${c.accessibility.colorblindMode==='tritanopia'?'selected':''}>Tritanopia</option>
        </select></label><br>
        <label><input type="checkbox" ${c.accessibility.reducedMotion?'checked':''} data-s="accessibility.reducedMotion"> Reduced Motion</label><br>
        <label><input type="checkbox" ${c.accessibility.highContrast?'checked':''} data-s="accessibility.highContrast"> High Contrast HUD</label><br>
        <label><input type="checkbox" ${c.accessibility.screenReaderHints?'checked':''} data-s="accessibility.screenReaderHints"> Screen Reader Hints</label><br>
        <label>Text Size <select data-s="accessibility.fontSize">
          <option value="small" ${c.accessibility.fontSize==='small'?'selected':''}>Small</option>
          <option value="medium" ${c.accessibility.fontSize==='medium'?'selected':''}>Medium</option>
          <option value="large" ${c.accessibility.fontSize==='large'?'selected':''}>Large</option>
        </select></label>
      </div>`;
  },

  /** Bind change events on a settings panel container element */
  bindPanel(container) {
    container.querySelectorAll('[data-s]').forEach(el => {
      const [cat, key] = el.dataset.s.split('.');
      const handler = () => {
        let val;
        if (el.type === 'checkbox') val = el.checked;
        else if (el.type === 'range') { val = parseFloat(el.value); el.nextElementSibling.textContent = el.step < 1 ? Math.round(val * 100) + '%' : val; }
        else val = el.value;
        this.set(cat, key, val);
        if (cat === 'audio') Audio.setVolume(key, val);
        Accessibility.apply(this.get('accessibility'));
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
  },
};


// ═══════════════════════════════════════════════════════════════════
//  ACCESSIBILITY — Colorblind filters, reduced motion, font scaling
// ═══════════════════════════════════════════════════════════════════
const Accessibility = {
  _style: null,

  init() {
    this._style = document.createElement('style');
    this._style.id = 'dz-accessibility';
    document.head.appendChild(this._style);
    this.apply(Settings.get('accessibility'));
  },

  apply(cfg) {
    let css = '';

    // Colorblind SVG filters
    const filters = {
      deuteranopia: 'url(#dz-deuteranopia)',
      protanopia:   'url(#dz-protanopia)',
      tritanopia:   'url(#dz-tritanopia)',
    };
    if (cfg.colorblindMode && cfg.colorblindMode !== 'none') {
      css += `canvas { filter: ${filters[cfg.colorblindMode] || 'none'}; }\n`;
      this._ensureSVGFilters();
    }

    // Reduced motion
    if (cfg.reducedMotion) {
      css += `*, *::before, *::after { animation-duration: 0.01s !important; transition-duration: 0.01s !important; }\n`;
    }

    // High contrast
    if (cfg.highContrast) {
      css += `#xh .xd { width: 4px; height: 4px; box-shadow: 0 0 4px #fff; }
              .vf.sh { background: #00aaff !important; }
              .vf.hp { background: #00ff44 !important; }
              .dn { font-size: 1.2rem !important; text-shadow: 0 0 6px rgba(0,0,0,1) !important; }\n`;
    }

    // Font size
    const sizes = { small: '0.85', medium: '1', large: '1.2' };
    const scale = sizes[cfg.fontSize] || '1';
    if (scale !== '1') {
      css += `body { font-size: calc(${scale} * 100%); }\n`;
    }

    this._style.textContent = css;

    // ARIA live region for screen reader hints
    if (cfg.screenReaderHints) {
      if (!document.getElementById('dz-aria-live')) {
        const ar = document.createElement('div');
        ar.id = 'dz-aria-live';
        ar.setAttribute('role', 'status');
        ar.setAttribute('aria-live', 'polite');
        ar.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden';
        document.body.appendChild(ar);
      }
    }
  },

  /** Announce to screen readers */
  announce(text) {
    const el = document.getElementById('dz-aria-live');
    if (el) { el.textContent = ''; requestAnimationFrame(() => { el.textContent = text; }); }
  },

  _ensureSVGFilters() {
    if (document.getElementById('dz-cb-filters')) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'dz-cb-filters';
    svg.style.cssText = 'position:absolute;width:0;height:0';
    svg.innerHTML = `
      <filter id="dz-deuteranopia"><feColorMatrix type="matrix" values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0"/></filter>
      <filter id="dz-protanopia"><feColorMatrix type="matrix" values="0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0"/></filter>
      <filter id="dz-tritanopia"><feColorMatrix type="matrix" values="0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0"/></filter>`;
    document.body.appendChild(svg);
  },
};


// ═══════════════════════════════════════════════════════════════════
//  PERFORMANCE MONITOR — Frame budget, GC detection, auto-quality
// ═══════════════════════════════════════════════════════════════════
const Perf = {
  _frames: [],
  _gcSpikeThreshold: 50,   // ms — frames longer than this are likely GC
  _targetFPS: 60,
  _autoQuality: true,
  _qualityLevel: 2,        // 0=low, 1=medium, 2=high
  _lastCheck: 0,
  _frameStart: 0,

  stats: { fps: 0, avgFrame: 0, p99Frame: 0, gcSpikes: 0, drawCalls: 0 },

  beginFrame() {
    this._frameStart = performance.now();
  },

  endFrame(renderer = null) {
    const elapsed = performance.now() - this._frameStart;
    this._frames.push(elapsed);
    if (this._frames.length > 120) this._frames.shift();

    // GC spike detection
    if (elapsed > this._gcSpikeThreshold) this.stats.gcSpikes++;

    // Update stats every 30 frames
    if (this._frames.length % 30 === 0) {
      const sorted = [...this._frames].sort((a, b) => a - b);
      this.stats.avgFrame = +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1);
      this.stats.p99Frame = +(sorted[Math.floor(sorted.length * 0.99)] || 0).toFixed(1);
      this.stats.fps = Math.round(1000 / this.stats.avgFrame);

      if (renderer) {
        this.stats.drawCalls = renderer.info?.render?.calls || 0;
        this.stats.triangles = renderer.info?.render?.triangles || 0;
      }

      // Auto-quality adjustment
      if (this._autoQuality) this._adjustQuality();
    }
  },

  _adjustQuality() {
    const now = performance.now();
    if (now - this._lastCheck < 5000) return; // check every 5s
    this._lastCheck = now;

    if (this.stats.fps < 30 && this._qualityLevel > 0) {
      this._qualityLevel--;
      Log.warn('Perf', `FPS ${this.stats.fps} — reducing quality to ${['low','medium','high'][this._qualityLevel]}`);
      this._applyQuality();
    } else if (this.stats.fps > 55 && this._qualityLevel < 2) {
      this._qualityLevel++;
      Log.info('Perf', `FPS ${this.stats.fps} — increasing quality to ${['low','medium','high'][this._qualityLevel]}`);
      this._applyQuality();
    }
  },

  _applyQuality() {
    // These hooks would adjust renderer settings
    // Exposed for the game loop to query
  },

  getQuality() { return this._qualityLevel; },
  getStats() { return { ...this.stats }; },
};


// ═══════════════════════════════════════════════════════════════════
//  ERROR LOGGING — Structured log with levels, categories, buffering
// ═══════════════════════════════════════════════════════════════════
const Log = {
  _buffer: [],
  _maxBuffer: 200,
  _remoteEndpoint: null,  // set to URL for remote logging

  /** Structured log entry */
  _log(level, category, message, data = null) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      cat: category,
      msg: message,
      data,
    };
    this._buffer.push(entry);
    if (this._buffer.length > this._maxBuffer) this._buffer.shift();

    // Console output
    const prefix = `[${level.toUpperCase()}][${category}]`;
    if (level === 'error') console.error(prefix, message, data || '');
    else if (level === 'warn') console.warn(prefix, message, data || '');
    else console.log(prefix, message, data || '');

    // Remote flush (batch)
    if (this._remoteEndpoint && level === 'error') {
      this._flush();
    }
  },

  info(cat, msg, data)  { this._log('info', cat, msg, data); },
  warn(cat, msg, data)  { this._log('warn', cat, msg, data); },
  error(cat, msg, data) { this._log('error', cat, msg, data); },

  /** Install global error handlers */
  installGlobalHandlers() {
    window.addEventListener('error', (e) => {
      this.error('Runtime', e.message, { file: e.filename, line: e.lineno, col: e.colno });
    });
    window.addEventListener('unhandledrejection', (e) => {
      this.error('Promise', String(e.reason));
    });
  },

  /** Get buffered logs (for crash reports, debug panels) */
  getBuffer() { return [...this._buffer]; },

  /** Set remote logging endpoint */
  setRemoteEndpoint(url) { this._remoteEndpoint = url; },

  _flush() {
    if (!this._remoteEndpoint || this._buffer.length === 0) return;
    const payload = this._buffer.splice(0, 50);
    try {
      navigator.sendBeacon(this._remoteEndpoint, JSON.stringify(payload));
    } catch {}
  },
};


// ═══════════════════════════════════════════════════════════════════
//  TUTORIAL — Contextual hint overlay system
// ═══════════════════════════════════════════════════════════════════
const Tutorial = {
  _container: null,
  _active: null,
  _dismissed: new Set(),

  HINTS: {
    movement:   { text: 'WASD to move · SHIFT to sprint · CTRL to slide · SPACE to jump', pos: 'bottom', autoHide: 8 },
    shooting:   { text: 'LMB to fire · R to reload · 1-2 or SCROLL to swap weapons', pos: 'bottom', autoHide: 6 },
    abilities:  { text: 'Q — Tactical Ability · Z — Ultimate Ability', pos: 'bottom', autoHide: 6 },
    interact:   { text: 'E to interact · Pick up loot, revive teammates, ride ziplines', pos: 'center', autoHide: 6 },
    consumables:{ text: '3 Syringe · 4 Med Kit · 5 Shield Cell · 6 Battery', pos: 'bottom', autoHide: 6 },
    ring:       { text: 'Stay inside the ring! The zone shrinks over time.', pos: 'top', autoHide: 8 },
    doors:      { text: 'Press F to open/close doors', pos: 'center', autoHide: 5 },
    pings:      { text: 'Z to ping · Team communication', pos: 'bottom', autoHide: 5 },
    downed:     { text: 'You are downed! Teammates can revive you with E.', pos: 'center', autoHide: 0 },
    loot_rarity:{ text: 'Loot comes in tiers: Common → Rare → Epic → Legendary', pos: 'center', autoHide: 8 },
    banner:     { text: 'Grab fallen teammates\' banners and bring them to a Respawn Beacon', pos: 'center', autoHide: 8 },
  },

  init() {
    this._container = document.createElement('div');
    this._container.id = 'dz-tutorial';
    this._container.style.cssText = 'position:fixed;z-index:180;pointer-events:none;left:0;right:0;display:flex;justify-content:center;transition:opacity 0.4s;opacity:0';
    document.body.appendChild(this._container);

    // Restore dismissed hints
    const saved = Settings.get('tutorial');
    if (saved.completed) this._dismissed = new Set(saved.completed);
    if (saved.skipped) this._dismissed = new Set(Object.keys(this.HINTS));
  },

  /** Show a contextual hint (only once per session unless forced) */
  show(hintId, force = false) {
    if (this._dismissed.has(hintId) && !force) return;
    const hint = this.HINTS[hintId];
    if (!hint) return;
    this._dismissed.add(hintId);
    Settings.set('tutorial', 'completed', [...this._dismissed]);

    this._container.style.top = hint.pos === 'top' ? '60px' : hint.pos === 'center' ? '35%' : '';
    this._container.style.bottom = hint.pos === 'bottom' ? '120px' : '';
    this._container.innerHTML = `<div style="background:rgba(6,6,12,.88);border:1px solid rgba(232,197,71,.2);padding:10px 20px;border-radius:6px;font-size:.6rem;color:#ccc;letter-spacing:.04em;text-align:center;max-width:500px;backdrop-filter:blur(4px)"><span style="color:#e8c547;font-size:.5rem;letter-spacing:.1em;display:block;margin-bottom:4px">TIP</span>${hint.text}</div>`;
    this._container.style.opacity = '1';
    this._active = hintId;

    if (hint.autoHide > 0) {
      setTimeout(() => this.hide(hintId), hint.autoHide * 1000);
    }

    Accessibility.announce(hint.text);
  },

  hide(hintId = null) {
    if (hintId && this._active !== hintId) return;
    this._container.style.opacity = '0';
    this._active = null;
  },

  /** Skip all future tutorials */
  skipAll() {
    this._dismissed = new Set(Object.keys(this.HINTS));
    Settings.set('tutorial', 'skipped', true);
    this.hide();
  },

  /** Reset tutorials (show them again) */
  reset() {
    this._dismissed.clear();
    Settings.save('tutorial', { completed: [], skipped: false });
  },

  /** Check if a specific tutorial has been shown */
  hasShown(hintId) { return this._dismissed.has(hintId); },
};


// ═══════════════════════════════════════════════════════════════════
//  VFX MANAGER — Particle pool, screen effects, muzzle flash queue
// ═══════════════════════════════════════════════════════════════════
const VFX = {
  _pool: [],       // reusable particle meshes
  _active: [],     // { mesh, vel, life, maxLife }
  _poolSize: 50,
  _scene: null,

  init(scene) {
    this._scene = scene;
    // Pre-allocate particle pool
    const geo = new THREE.SphereGeometry(0.04, 4, 3);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffaa44 });
    for (let i = 0; i < this._poolSize; i++) {
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.visible = false;
      scene.add(mesh);
      this._pool.push(mesh);
    }
  },

  /** Spawn particles at a world position (e.g., bullet impact) */
  spawnImpact(pos, color = 0xffaa44, count = 5) {
    for (let i = 0; i < count; i++) {
      const mesh = this._pool.find(m => !m.visible);
      if (!mesh) break;
      mesh.visible = true;
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.material.color.setHex(color);
      const vel = {
        x: (Math.random() - 0.5) * 4,
        y: Math.random() * 3 + 1,
        z: (Math.random() - 0.5) * 4,
      };
      this._active.push({ mesh, vel, life: 0.4 + Math.random() * 0.3, maxLife: 0.7 });
    }
  },

  /** Spawn a ring pulse effect (ability activation, shield break) */
  spawnRing(pos, color = 0x5ab8f5, radius = 3) {
    const geo = new THREE.RingGeometry(0.1, radius, 24);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: 2, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, pos.y + 0.1, pos.z);
    this._scene.add(mesh);
    this._active.push({ mesh, vel: null, life: 0.6, maxLife: 0.6, scaleSpeed: radius * 3, isRing: true });
  },

  /** Tick all active particles */
  tick(dt) {
    for (let i = this._active.length - 1; i >= 0; i--) {
      const p = this._active[i];
      p.life -= dt;

      if (p.isRing) {
        const t = 1 - p.life / p.maxLife;
        const s = 1 + t * p.scaleSpeed;
        p.mesh.scale.set(s, s, s);
        p.mesh.material.opacity = (1 - t) * 0.5;
      } else if (p.vel) {
        p.mesh.position.x += p.vel.x * dt;
        p.mesh.position.y += p.vel.y * dt;
        p.mesh.position.z += p.vel.z * dt;
        p.vel.y -= 9.8 * dt;
        const alpha = p.life / p.maxLife;
        p.mesh.material.opacity = alpha;
      }

      if (p.life <= 0) {
        if (p.isRing) { this._scene.remove(p.mesh); }
        else { p.mesh.visible = false; }
        this._active.splice(i, 1);
      }
    }
  },

  /** Screen flash effect (hit, ability, etc.) */
  screenFlash(color = '#e8c547', duration = 0.15) {
    const el = document.getElementById('abil-flash');
    if (!el) return;
    el.style.background = `radial-gradient(ellipse at center, ${color}22 0%, ${color}08 50%, transparent 80%)`;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, duration * 1000);
  },
};


// ═══════════════════════════════════════════════════════════════════
//  UI TRANSITIONS — Screen fades, match intro, results overlay
// ═══════════════════════════════════════════════════════════════════
const Transitions = {
  _overlay: null,

  init() {
    this._overlay = document.createElement('div');
    this._overlay.id = 'dz-transition';
    this._overlay.style.cssText = 'position:fixed;inset:0;z-index:300;background:#06060a;opacity:0;pointer-events:none;transition:opacity 0.5s';
    document.body.appendChild(this._overlay);
  },

  /** Fade to black, call fn, then fade back */
  async fadeThrough(fn, holdMs = 300) {
    this._overlay.style.pointerEvents = 'all';
    this._overlay.style.opacity = '1';
    await this._wait(500);
    if (fn) await fn();
    await this._wait(holdMs);
    this._overlay.style.opacity = '0';
    await this._wait(500);
    this._overlay.style.pointerEvents = 'none';
  },

  /** Fade in from black (for match start) */
  async fadeIn(durationMs = 800) {
    this._overlay.style.transition = `opacity ${durationMs}ms`;
    this._overlay.style.opacity = '1';
    await this._wait(50);
    this._overlay.style.opacity = '0';
    await this._wait(durationMs);
    this._overlay.style.transition = 'opacity 0.5s';
  },

  _wait(ms) { return new Promise(r => setTimeout(r, ms)); },
};


// ═══════════════════════════════════════════════════════════════════
//  SHELL — Top-level init and export
// ═══════════════════════════════════════════════════════════════════
const Shell = {
  Audio,
  Settings,
  Accessibility,
  Perf,
  Log,
  Tutorial,
  VFX,
  Transitions,

  /** Initialize all shell systems. Call once at app startup. */
  init(scene = null) {
    Settings.init();
    Accessibility.init();
    Tutorial.init();
    Transitions.init();
    Log.installGlobalHandlers();
    if (scene) VFX.init(scene);
    Log.info('Shell', 'Production shell initialized');
  },
};

// Export
if (typeof module !== 'undefined') module.exports = Shell;
else window.Shell = Shell;
