/**
 * services/challenges.js
 * ═══════════════════════════════════════════════════════════════════════
 * Daily and weekly challenge system.
 *
 * Challenges are drawn from the pool in config/challenges.json.
 * Progress is tracked per-player and accumulates across matches.
 * Completed challenges award XP and battle pass progress.
 *
 * The server calls Challenges.onMatchComplete() after each match
 * with the player's match stats. The service checks all active
 * challenges and advances progress where applicable.
 * ═══════════════════════════════════════════════════════════════════════
 */

const store = require('../data/store');
const challengeCfg = require('../config/challenges.json');

const NS = 'challenges';

/**
 * Get the current UTC day key (e.g., "2026-04-15")
 */
function dayKey() { return new Date().toISOString().slice(0, 10); }

/**
 * Get the current UTC week key (ISO week number)
 */
function weekKey() {
  const d = new Date();
  const oneJan = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Select N random challenges from a pool without duplicates.
 */
function pickRandom(pool, count) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

const Challenges = {
  /**
   * Get a player's active challenges. Generates new ones if needed.
   * @param {string} playerId
   * @returns {Promise<{ daily: object[], weekly: object[] }>}
   */
  async getActive(playerId) {
    let data = await store.get(NS, playerId);
    const today = dayKey();
    const thisWeek = weekKey();

    if (!data) {
      data = { daily: [], dailyDay: null, weekly: [], weeklyWeek: null, rerollsToday: 0, rerollDay: null };
    }

    // Refresh daily challenges if day has changed
    if (data.dailyDay !== today) {
      data.daily = pickRandom(challengeCfg.daily.pool, challengeCfg.daily.count).map(c => ({
        ...c, progress: 0, completed: false, claimed: false,
      }));
      data.dailyDay = today;
      data.rerollsToday = 0;
      data.rerollDay = today;
    }

    // Refresh weekly challenges if week has changed
    if (data.weeklyWeek !== thisWeek) {
      data.weekly = pickRandom(challengeCfg.weekly.pool, challengeCfg.weekly.count).map(c => ({
        ...c, progress: 0, completed: false, claimed: false,
      }));
      data.weeklyWeek = thisWeek;
    }

    await store.set(NS, playerId, data);
    return { daily: data.daily, weekly: data.weekly };
  },

  /**
   * Process match results and advance challenge progress.
   * Called after Accounts.recordMatchResult().
   *
   * @param {string} playerId
   * @param {object} matchStats — the matchData object from accounts service
   * @returns {Promise<object[]>} Array of newly completed challenges
   */
  async onMatchComplete(playerId, matchStats) {
    let data = await store.get(NS, playerId);
    if (!data) {
      await this.getActive(playerId); // initialize
      data = await store.get(NS, playerId);
    }

    const completed = [];

    // Build a stat map from the match for lookup
    const statMap = {
      kills: matchStats.kills,
      damageDealt: matchStats.damageDealt,
      wins: matchStats.won ? 1 : 0,
      top3Finishes: matchStats.placement <= 3 ? 1 : 0,
      top5Finishes: matchStats.placement <= 5 ? 1 : 0,
      revives: matchStats.revives,
      headshotKnocks: matchStats.headshotKnocks,
      matchesPlayed: 1,
      itemsLooted: matchStats.itemsLooted,
      tacticalUses: matchStats.tacticalUses,
      ultimateUses: matchStats.ultimateUses,
      longestSurvivalMinutes: matchStats.survivalMinutes,
      // Per-hero tracking
      [`matchesAs${capitalize(matchStats.heroId)}`]: 1,
      uniqueHeroes: matchStats.heroId, // special handling below
    };

    // Process each active challenge
    const allChallenges = [...data.daily, ...data.weekly];
    for (const ch of allChallenges) {
      if (ch.completed) continue;

      // Hero filter: skip if challenge requires a specific hero and we played a different one
      if (ch.heroFilter && ch.heroFilter !== matchStats.heroId) continue;

      // Special case: uniqueHeroes tracks distinct heroes played
      if (ch.stat === 'uniqueHeroes') {
        if (!ch._heroSet) ch._heroSet = [];
        if (!ch._heroSet.includes(matchStats.heroId)) {
          ch._heroSet.push(matchStats.heroId);
          ch.progress = ch._heroSet.length;
        }
      } else {
        // Standard stat accumulation
        const increment = statMap[ch.stat] || 0;
        if (increment > 0) ch.progress += increment;
      }

      // Check completion
      if (ch.progress >= ch.target && !ch.completed) {
        ch.completed = true;
        completed.push(ch);
      }
    }

    await store.set(NS, playerId, data);
    return completed;
  },

  /**
   * Claim rewards for a completed challenge.
   * @param {string} playerId
   * @param {string} challengeId
   * @returns {Promise<{ xp: number }|null>} Reward info or null if not claimable
   */
  async claimReward(playerId, challengeId) {
    const data = await store.get(NS, playerId);
    if (!data) return null;

    const allChallenges = [...data.daily, ...data.weekly];
    const ch = allChallenges.find(c => c.id === challengeId);
    if (!ch || !ch.completed || ch.claimed) return null;

    ch.claimed = true;
    await store.set(NS, playerId, data);

    return { xp: ch.xp, challengeId: ch.id, challengeName: ch.name };
  },

  /**
   * Reroll one daily challenge (swap for a different one from the pool).
   * Limited to rerollsPerDay from config.
   */
  async rerollDaily(playerId, challengeIndex) {
    const data = await store.get(NS, playerId);
    if (!data) return null;
    if (data.rerollsToday >= challengeCfg.daily.rerollsPerDay) return null;
    if (challengeIndex < 0 || challengeIndex >= data.daily.length) return null;
    if (data.daily[challengeIndex].completed) return null;

    // Pick a new challenge not already in the active set
    const activeIds = new Set(data.daily.map(c => c.id));
    const available = challengeCfg.daily.pool.filter(c => !activeIds.has(c.id));
    if (available.length === 0) return null;

    const replacement = available[Math.floor(Math.random() * available.length)];
    data.daily[challengeIndex] = { ...replacement, progress: 0, completed: false, claimed: false };
    data.rerollsToday++;

    await store.set(NS, playerId, data);
    return data.daily[challengeIndex];
  },
};

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

module.exports = Challenges;
