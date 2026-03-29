/**
 * services/accounts.js
 * ═══════════════════════════════════════════════════════════════════════
 * Account profiles, XP/level progression, lifetime stat tracking,
 * and match history.
 *
 * Every player action flows through recordMatchResult() which handles
 * XP awards, stat accumulation, level-ups, and history storage.
 * ═══════════════════════════════════════════════════════════════════════
 */

const store = require('../data/store');
const seasonCfg = require('../config/seasons.json');

const NS = {
  ACCOUNTS: 'accounts',
  STATS:    'stats',
  HISTORY:  'match_history',
};

/**
 * Create a default account profile for a new player.
 * Called once during first authentication.
 */
function createDefaultProfile(playerId, displayName) {
  return {
    playerId,
    displayName,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),

    // Progression
    level: 1,
    xp: 0,
    xpToNextLevel: seasonCfg.xp.baseXP,
    totalXPEarned: 0,
    prestige: 0,

    // Currency placeholders
    craftingMetals: 0,
    premiumCurrency: 0,

    // Flags
    hasPremiumPass: false,
    firstMatchToday: true,
    lastMatchDate: null,

    // Equipped cosmetics (placeholder hooks)
    equipped: {
      skin: {},          // heroId → skinId
      banner: null,
      badge: [null, null, null],  // 3 badge slots
      quip: {},          // heroId → quipId
      trail: null,
    },

    // Unlocked items (set of IDs)
    unlocks: [],
  };
}

/**
 * Create default lifetime stats.
 */
function createDefaultStats(playerId) {
  return {
    playerId,
    season: seasonCfg.currentSeason,

    // Lifetime (never reset)
    lifetime: {
      matchesPlayed: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      damageDealt: 0,
      damageTaken: 0,
      revives: 0,
      respawns: 0,
      headshotKnocks: 0,
      top3Finishes: 0,
      top5Finishes: 0,
      timeSurvivedMinutes: 0,
      itemsLooted: 0,
      tacticalUses: 0,
      ultimateUses: 0,
    },

    // Season-scoped (reset each season)
    season: {
      matchesPlayed: 0, wins: 0, kills: 0, deaths: 0,
      assists: 0, damageDealt: 0, revives: 0,
      top3Finishes: 0, top5Finishes: 0,
    },

    // Per-hero stats
    heroes: {},  // heroId → { matchesPlayed, kills, wins, damageDealt, ... }

    // Derived (calculated, not accumulated)
    kd: 0,
    winRate: 0,
    avgDamage: 0,

    // Tracking for daily first-match bonus
    lastMatchDay: null,
  };
}

const Accounts = {
  /**
   * Get or create an account profile.
   * @param {string} playerId
   * @param {string} displayName
   * @returns {Promise<object>} The profile
   */
  async getOrCreate(playerId, displayName) {
    let profile = await store.get(NS.ACCOUNTS, playerId);
    if (!profile) {
      profile = createDefaultProfile(playerId, displayName);
      await store.set(NS.ACCOUNTS, playerId, profile);

      const stats = createDefaultStats(playerId);
      await store.set(NS.STATS, playerId, stats);
    }
    return profile;
  },

  /** Get profile (returns null if not found) */
  async getProfile(playerId) {
    return store.get(NS.ACCOUNTS, playerId);
  },

  /** Update last login timestamp */
  async touchLogin(playerId) {
    const profile = await store.get(NS.ACCOUNTS, playerId);
    if (!profile) return;
    const today = new Date().toISOString().slice(0, 10);
    profile.lastLoginAt = new Date().toISOString();
    profile.firstMatchToday = profile.lastMatchDate !== today;
    await store.set(NS.ACCOUNTS, playerId, profile);
  },

  /** Get lifetime + season stats */
  async getStats(playerId) {
    return store.get(NS.STATS, playerId);
  },

  /**
   * Record a completed match. This is the main entry point.
   * Called by the integration layer after a match ends.
   *
   * @param {string} playerId
   * @param {object} matchData — shape defined below
   * @returns {Promise<object>} { xpEarned, levelsGained, newLevel, newXP, challengeProgress }
   */
  async recordMatchResult(playerId, matchData) {
    /**
     * matchData shape:
     * {
     *   matchId: string,
     *   heroId: string,
     *   placement: number,       // 1-5 (squad rank)
     *   kills: number,
     *   assists: number,
     *   deaths: number,
     *   damageDealt: number,
     *   damageTaken: number,
     *   revives: number,
     *   respawns: number,
     *   headshotKnocks: number,
     *   survivalMinutes: number,
     *   itemsLooted: number,
     *   tacticalUses: number,
     *   ultimateUses: number,
     *   won: boolean,
     *   squadmates: [{ playerId, name }],
     *   timestamp: string,       // ISO datetime
     * }
     */

    const profile = await store.get(NS.ACCOUNTS, playerId);
    const stats = await store.get(NS.STATS, playerId);
    if (!profile || !stats) return null;

    // ── Accumulate stats ──
    const lt = stats.lifetime;
    const sn = stats.season;
    lt.matchesPlayed++; sn.matchesPlayed++;
    lt.kills += matchData.kills; sn.kills += matchData.kills;
    lt.deaths += matchData.deaths; sn.deaths += matchData.deaths;
    lt.assists += matchData.assists; sn.assists += matchData.assists;
    lt.damageDealt += matchData.damageDealt; sn.damageDealt += matchData.damageDealt;
    lt.damageTaken += matchData.damageTaken;
    lt.revives += matchData.revives; sn.revives += matchData.revives;
    lt.respawns += matchData.respawns;
    lt.headshotKnocks += matchData.headshotKnocks;
    lt.itemsLooted += matchData.itemsLooted;
    lt.tacticalUses += matchData.tacticalUses;
    lt.ultimateUses += matchData.ultimateUses;
    lt.timeSurvivedMinutes += matchData.survivalMinutes;
    if (matchData.won) { lt.wins++; sn.wins++; }
    if (matchData.placement <= 3) { lt.top3Finishes++; sn.top3Finishes++; }
    if (matchData.placement <= 5) { lt.top5Finishes++; sn.top5Finishes++; }

    // Per-hero stats
    if (!stats.heroes[matchData.heroId]) {
      stats.heroes[matchData.heroId] = { matchesPlayed: 0, kills: 0, wins: 0, damageDealt: 0 };
    }
    const heroStats = stats.heroes[matchData.heroId];
    heroStats.matchesPlayed++;
    heroStats.kills += matchData.kills;
    heroStats.damageDealt += matchData.damageDealt;
    if (matchData.won) heroStats.wins++;

    // Derived stats
    stats.kd = lt.deaths > 0 ? +(lt.kills / lt.deaths).toFixed(2) : lt.kills;
    stats.winRate = lt.matchesPlayed > 0 ? +(lt.wins / lt.matchesPlayed * 100).toFixed(1) : 0;
    stats.avgDamage = lt.matchesPlayed > 0 ? Math.round(lt.damageDealt / lt.matchesPlayed) : 0;

    // ── Calculate XP ──
    const xpCfg = seasonCfg.xp;
    let xpEarned = xpCfg.matchRewards.participation;
    xpEarned += matchData.survivalMinutes * xpCfg.matchRewards.survivalPerMinute;
    xpEarned += matchData.kills * xpCfg.matchRewards.killXP;
    xpEarned += matchData.assists * xpCfg.matchRewards.assistXP;
    xpEarned += Math.floor(matchData.damageDealt / 100) * xpCfg.matchRewards.damageXPPer100;
    xpEarned += matchData.revives * xpCfg.matchRewards.reviveXP;
    xpEarned += matchData.respawns * xpCfg.matchRewards.respawnXP;
    if (matchData.won) xpEarned += xpCfg.matchRewards.winXP;
    else if (matchData.placement <= 3) xpEarned += xpCfg.matchRewards.top3XP;
    else if (matchData.placement <= 5) xpEarned += xpCfg.matchRewards.top5XP;

    // First match of day bonus
    const today = new Date().toISOString().slice(0, 10);
    if (stats.lastMatchDay !== today) {
      xpEarned += xpCfg.bonuses.firstMatchOfDay;
      stats.lastMatchDay = today;
      profile.firstMatchToday = false;
    }

    // Premium multiplier
    if (profile.hasPremiumPass) {
      xpEarned = Math.round(xpEarned * xpCfg.bonuses.premiumMultiplier);
    }

    // ── Apply XP → levels ──
    const startLevel = profile.level;
    profile.xp += xpEarned;
    profile.totalXPEarned += xpEarned;

    while (profile.xp >= profile.xpToNextLevel && profile.level < seasonCfg.xp.maxLevel) {
      profile.xp -= profile.xpToNextLevel;
      profile.level++;
      profile.xpToNextLevel = seasonCfg.xp.baseXP + (profile.level - 1) * seasonCfg.xp.xpPerLevel;
    }

    // Prestige check
    if (profile.level >= seasonCfg.xp.maxLevel && seasonCfg.prestige.enabled
        && profile.prestige < seasonCfg.prestige.maxPrestige) {
      // Do not auto-prestige; player must opt-in (future: prestige endpoint)
    }

    const levelsGained = profile.level - startLevel;

    // ── Update last match date ──
    profile.lastMatchDate = today;

    // ── Store match in history ──
    const historyEntry = {
      matchId: matchData.matchId,
      heroId: matchData.heroId,
      placement: matchData.placement,
      kills: matchData.kills,
      assists: matchData.assists,
      damageDealt: matchData.damageDealt,
      won: matchData.won,
      xpEarned,
      timestamp: matchData.timestamp || new Date().toISOString(),
    };
    await this._appendHistory(playerId, historyEntry);

    // ── Persist ──
    await store.set(NS.ACCOUNTS, playerId, profile);
    await store.set(NS.STATS, playerId, stats);

    return {
      xpEarned,
      levelsGained,
      newLevel: profile.level,
      newXP: profile.xp,
      xpToNext: profile.xpToNextLevel,
      matchData,  // pass through for challenge service
    };
  },

  /** Append a match to history, capping at maxStoredMatches */
  async _appendHistory(playerId, entry) {
    let history = await store.get(NS.HISTORY, playerId);
    if (!history) history = [];
    history.unshift(entry);
    if (history.length > seasonCfg.matchHistory.maxStoredMatches) {
      history = history.slice(0, seasonCfg.matchHistory.maxStoredMatches);
    }
    await store.set(NS.HISTORY, playerId, history);
  },

  /** Get match history */
  async getHistory(playerId, limit = 20) {
    const history = await store.get(NS.HISTORY, playerId);
    return (history || []).slice(0, limit);
  },

  /** Grant currency to a player */
  async grantCurrency(playerId, type, amount) {
    const profile = await store.get(NS.ACCOUNTS, playerId);
    if (!profile) return;
    if (type === 'crafting_metals') profile.craftingMetals += amount;
    else if (type === 'premium_currency') profile.premiumCurrency += amount;
    await store.set(NS.ACCOUNTS, playerId, profile);
  },

  /** Unlock an item (cosmetic, badge, etc.) */
  async unlockItem(playerId, itemId) {
    const profile = await store.get(NS.ACCOUNTS, playerId);
    if (!profile) return false;
    if (profile.unlocks.includes(itemId)) return false; // already unlocked
    profile.unlocks.push(itemId);
    await store.set(NS.ACCOUNTS, playerId, profile);
    return true;
  },
};

module.exports = Accounts;
