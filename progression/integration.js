/**
 * integration.js
 * ═══════════════════════════════════════════════════════════════════════
 * Integration layer between the game server (server/server.js from the
 * multiplayer architecture) and the progression services.
 *
 * This module listens to match lifecycle events and routes data to
 * the appropriate services. It is the ONLY file that imports multiple
 * services — each service is independently testable.
 *
 * Wire this into the game server by calling:
 *   const prog = require('./integration');
 *   prog.onPlayerConnect(session);
 *   prog.onMatchEnd(matchId, results);
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

const Accounts   = require('./services/accounts');
const Challenges = require('./services/challenges');
const BattlePass = require('./services/battlepass');
const Ranked     = require('./services/ranked');
const Cosmetics  = require('./services/cosmetics');

const Progression = {
  /* ═══════════════════════════════════════════════════════════════
     LIFECYCLE HOOKS — called by the game server
     ═══════════════════════════════════════════════════════════════ */

  /**
   * Called when a player authenticates or reconnects.
   * Loads their profile, active challenges, and ranked state.
   * Returns a full progression snapshot for the client.
   */
  async onPlayerConnect(playerId, displayName) {
    // Ensure account exists
    const profile = await Accounts.getOrCreate(playerId, displayName);
    await Accounts.touchLogin(playerId);

    // Load all progression data
    const stats      = await Accounts.getStats(playerId);
    const challenges = await Challenges.getActive(playerId);
    const bpState    = await BattlePass.getState(playerId);
    const ranked     = await Ranked.getSummary(playerId);
    const unlocked   = await Cosmetics.getUnlocked(playerId);

    return {
      profile: {
        playerId: profile.playerId,
        displayName: profile.displayName,
        level: profile.level,
        xp: profile.xp,
        xpToNext: profile.xpToNextLevel,
        prestige: profile.prestige,
        craftingMetals: profile.craftingMetals,
        premiumCurrency: profile.premiumCurrency,
        equipped: profile.equipped,
      },
      stats: {
        lifetime: stats.lifetime,
        season: stats.season,
        kd: stats.kd,
        winRate: stats.winRate,
        avgDamage: stats.avgDamage,
      },
      challenges,
      battlepass: {
        tier: bpState.tier,
        xp: bpState.xp,
        xpForNext: bpState.xpForNextTier,
        premium: bpState.premium,
      },
      ranked,
      cosmeticsUnlocked: unlocked.map(c => c.id),
    };
  },

  /**
   * Called when a match ends for each player.
   * This is the main orchestration point — it:
   * 1. Records stats and awards XP
   * 2. Advances challenge progress
   * 3. Feeds XP into the battle pass
   * 4. Updates ranked RP (if ranked match)
   * 5. Grants any unlocked rewards
   *
   * @param {string} playerId
   * @param {object} matchData — per-player match results
   * @param {boolean} isRanked — whether this was a ranked match
   * @returns {object} Complete post-match summary for the client
   */
  async onMatchEnd(playerId, matchData, isRanked = false) {
    const results = {};

    // ── 1. Stats + XP ──
    const accountResult = await Accounts.recordMatchResult(playerId, matchData);
    if (!accountResult) return null;
    results.xp = {
      earned: accountResult.xpEarned,
      newLevel: accountResult.newLevel,
      levelsGained: accountResult.levelsGained,
      currentXP: accountResult.newXP,
      xpToNext: accountResult.xpToNext,
    };

    // ── 2. Challenges ──
    const completedChallenges = await Challenges.onMatchComplete(playerId, matchData);
    results.challenges = {
      completed: completedChallenges.map(c => ({
        id: c.id, name: c.name, xp: c.xp,
      })),
    };

    // Auto-claim completed challenges and add their XP
    let challengeXP = 0;
    for (const ch of completedChallenges) {
      const claimed = await Challenges.claimReward(playerId, ch.id);
      if (claimed) challengeXP += claimed.xp;
    }
    // Award challenge XP to account
    if (challengeXP > 0) {
      const profile = await Accounts.getProfile(playerId);
      if (profile) {
        profile.xp += challengeXP;
        profile.totalXPEarned += challengeXP;
        // Re-check level-up
        const cfg = require('./config/seasons.json');
        while (profile.xp >= profile.xpToNextLevel && profile.level < cfg.xp.maxLevel) {
          profile.xp -= profile.xpToNextLevel;
          profile.level++;
          profile.xpToNextLevel = cfg.xp.baseXP + (profile.level - 1) * cfg.xp.xpPerLevel;
        }
        await require('./data/store').set('accounts', playerId, profile);
      }
    }
    results.challenges.totalXP = challengeXP;

    // ── 3. Battle Pass ──
    const totalXP = accountResult.xpEarned + challengeXP;
    const bpResult = await BattlePass.addXP(playerId, totalXP);
    results.battlepass = {
      tiersGained: bpResult.tiersGained,
      newTier: bpResult.newTier,
      pendingRewards: bpResult.pendingRewards,
    };

    // Grant any pending battle pass rewards
    for (const reward of bpResult.pendingRewards) {
      await this._grantReward(playerId, reward);
    }

    // ── 4. Ranked ──
    if (isRanked) {
      const rankedResult = await Ranked.recordMatch(playerId, matchData);
      results.ranked = rankedResult;
    }

    // ── 5. Get refreshed challenge state ──
    results.activeChallenges = await Challenges.getActive(playerId);

    return results;
  },

  /**
   * Grant a reward to a player (from battle pass, ranked, etc.)
   * Routes based on reward type.
   */
  async _grantReward(playerId, reward) {
    switch (reward.rewardType) {
      case 'currency':
        await Accounts.grantCurrency(playerId, reward.rewardId, reward.amount);
        break;
      case 'skin':
      case 'banner':
      case 'badge':
      case 'quip':
      case 'trail':
      case 'loot_box':
        await Accounts.unlockItem(playerId, reward.rewardId);
        break;
      case 'xp_boost':
        // Placeholder: store boost as a timed buff on the account
        await Accounts.unlockItem(playerId, reward.rewardId);
        break;
    }
  },

  /* ═══════════════════════════════════════════════════════════════
     CLIENT API ENDPOINTS — called by the API/WebSocket layer
     ═══════════════════════════════════════════════════════════════ */

  /** Get full profile for display */
  async getProfile(playerId) {
    return Accounts.getProfile(playerId);
  },

  /** Get match history */
  async getMatchHistory(playerId, limit) {
    return Accounts.getHistory(playerId, limit);
  },

  /** Get ranked summary */
  async getRankedSummary(playerId) {
    return Ranked.getSummary(playerId);
  },

  /** Get battle pass summary */
  async getBattlePassSummary(playerId) {
    return BattlePass.getSummary(playerId);
  },

  /** Purchase premium battle pass */
  async purchaseBattlePass(playerId) {
    return BattlePass.purchasePremium(playerId, Accounts);
  },

  /** Claim a battle pass reward */
  async claimBPReward(playerId, tier, track) {
    const reward = await BattlePass.claimReward(playerId, tier, track);
    if (reward) await this._grantReward(playerId, reward);
    return reward;
  },

  /** Equip a cosmetic */
  async equipCosmetic(playerId, slot, itemId) {
    return Cosmetics.equip(playerId, slot, itemId);
  },

  /** Get unlocked cosmetics */
  async getCosmetics(playerId) {
    return Cosmetics.getUnlocked(playerId);
  },

  /** Reroll a daily challenge */
  async rerollChallenge(playerId, index) {
    return Challenges.rerollDaily(playerId, index);
  },

  /** Get the cosmetics registry for client rendering */
  getCosmeticsRegistry() {
    return Cosmetics.getRegistry();
  },

  /** Apply ranked decay (call from daily cron) */
  async processDecay(playerId) {
    return Ranked.applyDecay(playerId);
  },

  /** Process season-end rewards for a player */
  async processSeasonEnd(playerId) {
    const rewards = await Ranked.getSeasonRewards(playerId);
    if (rewards) {
      for (const [type, itemId] of Object.entries(rewards)) {
        await Accounts.unlockItem(playerId, itemId);
      }
    }
    return rewards;
  },
};

module.exports = Progression;
