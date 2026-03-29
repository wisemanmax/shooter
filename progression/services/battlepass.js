/**
 * services/battlepass.js
 * ═══════════════════════════════════════════════════════════════════════
 * Battle pass progression system.
 *
 * XP from matches and challenges feeds into battle pass tier
 * advancement. Each tier unlocks rewards from the free track.
 * Players who purchase the premium pass also unlock the premium
 * track rewards.
 *
 * The service reads tier definitions from config/battlepass.json.
 * Add tiers or change rewards by editing the config — no code changes.
 * ═══════════════════════════════════════════════════════════════════════
 */

const store = require('../data/store');
const bpCfg = require('../config/battlepass.json');

const NS = 'battlepass';

const BattlePass = {
  /**
   * Get a player's battle pass state.
   * Creates default state if first access.
   */
  async getState(playerId) {
    let state = await store.get(NS, playerId);
    if (!state) {
      state = {
        playerId,
        season: bpCfg.season,
        tier: 0,
        xp: 0,
        xpForNextTier: bpCfg.xpPerTier,
        premium: false,
        claimedFree: [],     // tier numbers claimed
        claimedPremium: [],  // tier numbers claimed
      };
      await store.set(NS, playerId, state);
    }
    return state;
  },

  /**
   * Add XP to the battle pass. Automatically advances tiers.
   * @param {string} playerId
   * @param {number} xp — XP to add (from match result + challenge claims)
   * @returns {Promise<{ tiersGained, newTier, pendingRewards }>}
   */
  async addXP(playerId, xp) {
    const state = await this.getState(playerId);
    const startTier = state.tier;

    state.xp += xp;

    // Advance tiers
    while (state.xp >= state.xpForNextTier && state.tier < bpCfg.maxTier) {
      state.xp -= state.xpForNextTier;
      state.tier++;
      state.xpForNextTier = bpCfg.xpPerTier; // flat XP per tier (configurable)
    }

    // Cap at max tier
    if (state.tier >= bpCfg.maxTier) {
      state.tier = bpCfg.maxTier;
      state.xp = 0;
    }

    const tiersGained = state.tier - startTier;

    // Collect pending (unclaimed) rewards for newly reached tiers
    const pendingRewards = [];
    for (let t = startTier + 1; t <= state.tier; t++) {
      const freeReward = bpCfg.freeTiers[String(t)];
      if (freeReward && !state.claimedFree.includes(t)) {
        pendingRewards.push({ tier: t, track: 'free', ...freeReward });
      }
      if (state.premium) {
        const premReward = bpCfg.premiumTiers[String(t)];
        if (premReward && !state.claimedPremium.includes(t)) {
          pendingRewards.push({ tier: t, track: 'premium', ...premReward });
        }
      }
    }

    await store.set(NS, playerId, state);
    return { tiersGained, newTier: state.tier, pendingRewards };
  },

  /**
   * Claim a specific tier's reward.
   * @param {string} playerId
   * @param {number} tier
   * @param {'free'|'premium'} track
   * @returns {Promise<object|null>} The reward definition, or null if not claimable
   */
  async claimReward(playerId, tier, track) {
    const state = await this.getState(playerId);

    // Must have reached this tier
    if (tier > state.tier) return null;

    // Must not already be claimed
    const claimedList = track === 'premium' ? state.claimedPremium : state.claimedFree;
    if (claimedList.includes(tier)) return null;

    // Premium track requires premium pass
    if (track === 'premium' && !state.premium) return null;

    // Look up reward
    const rewardSource = track === 'premium' ? bpCfg.premiumTiers : bpCfg.freeTiers;
    const reward = rewardSource[String(tier)];
    if (!reward) return null;

    // Mark claimed
    claimedList.push(tier);
    await store.set(NS, playerId, state);

    return { tier, track, ...reward };
  },

  /**
   * Bulk-claim all unclaimed rewards up to the current tier.
   * Returns an array of claimed rewards.
   */
  async claimAll(playerId) {
    const state = await this.getState(playerId);
    const claimed = [];

    for (let t = 1; t <= state.tier; t++) {
      // Free track
      if (!state.claimedFree.includes(t) && bpCfg.freeTiers[String(t)]) {
        state.claimedFree.push(t);
        claimed.push({ tier: t, track: 'free', ...bpCfg.freeTiers[String(t)] });
      }
      // Premium track
      if (state.premium && !state.claimedPremium.includes(t) && bpCfg.premiumTiers[String(t)]) {
        state.claimedPremium.push(t);
        claimed.push({ tier: t, track: 'premium', ...bpCfg.premiumTiers[String(t)] });
      }
    }

    await store.set(NS, playerId, state);
    return claimed;
  },

  /**
   * Purchase the premium battle pass.
   * Returns true if successful (enough currency), false otherwise.
   */
  async purchasePremium(playerId, accountsService) {
    const state = await this.getState(playerId);
    if (state.premium) return { success: false, reason: 'Already owned' };

    const profile = await accountsService.getProfile(playerId);
    if (!profile) return { success: false, reason: 'Account not found' };

    const price = bpCfg.premiumPrice;
    if (price.currency === 'premium_currency' && profile.premiumCurrency < price.amount) {
      return { success: false, reason: 'Insufficient currency' };
    }

    // Deduct currency
    profile.premiumCurrency -= price.amount;
    profile.hasPremiumPass = true;
    state.premium = true;

    await store.set('accounts', playerId, profile);
    await store.set(NS, playerId, state);

    return { success: true };
  },

  /**
   * Get a summary of the battle pass for display.
   */
  async getSummary(playerId) {
    const state = await this.getState(playerId);

    // Build tier list with claimed status
    const tiers = [];
    for (let t = 1; t <= bpCfg.maxTier; t++) {
      const tier = {
        tier: t,
        reached: t <= state.tier,
        freeReward: bpCfg.freeTiers[String(t)] || null,
        freeClaimed: state.claimedFree.includes(t),
        premiumReward: bpCfg.premiumTiers[String(t)] || null,
        premiumClaimed: state.claimedPremium.includes(t),
      };
      tiers.push(tier);
    }

    return {
      currentTier: state.tier,
      xp: state.xp,
      xpForNext: state.xpForNextTier,
      premium: state.premium,
      maxTier: bpCfg.maxTier,
      tiers,
    };
  },
};

module.exports = BattlePass;
