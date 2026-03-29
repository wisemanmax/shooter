/**
 * services/ranked.js
 * ═══════════════════════════════════════════════════════════════════════
 * Ranked division and scoring system.
 *
 * Players accumulate RP (Ranked Points) from match performance.
 * RP determines division (Bronze → Predator). Each match costs an
 * entry fee that scales with division. Kill RP is capped to prevent
 * farming. Placement RP rewards survival.
 *
 * All scoring rules, division thresholds, and decay parameters are
 * defined in config/ranked.json — tunable without code changes.
 * ═══════════════════════════════════════════════════════════════════════
 */

const store = require('../data/store');
const rankedCfg = require('../config/ranked.json');

const NS = 'ranked';

const Ranked = {
  /**
   * Get or create a player's ranked state.
   */
  async getState(playerId) {
    let state = await store.get(NS, playerId);
    if (!state) {
      state = {
        playerId,
        season: rankedCfg.season,
        split: rankedCfg.currentSplit,
        rp: 0,
        peakRP: 0,
        peakDivision: 'bronze',
        matchesPlayed: 0,
        placementMatchesLeft: rankedCfg.splitReset.placementMatches,
        winStreak: 0,
        lastMatchDate: null,
        history: [],  // last 10 RP changes for display
      };
      await store.set(NS, playerId, state);
    }
    return state;
  },

  /**
   * Calculate RP change for a completed ranked match.
   * @param {object} matchData — same shape as accounts service matchData
   * @param {number} currentRP — player's current RP (for entry cost lookup)
   * @returns {object} { rpChange, breakdown, newRP }
   */
  calculateRP(matchData, currentRP) {
    const scoring = rankedCfg.scoring;
    const division = this.getDivision(currentRP);
    const entryCost = division.entryCost;

    // Start with negative entry cost
    let rpChange = -entryCost;
    const breakdown = { entryCost: -entryCost };

    // Placement RP
    let placementRP = 0;
    for (const [minPlace, rp] of Object.entries(scoring.placement).sort((a, b) => +a[0] - +b[0])) {
      if (matchData.placement <= +minPlace) {
        placementRP = rp;
        break;
      }
    }
    rpChange += placementRP;
    breakdown.placement = placementRP;

    // Kill + assist RP (capped)
    const killCount = Math.min(
      matchData.kills + matchData.assists,
      scoring.kills.killCap
    );
    const killRP = matchData.kills * scoring.kills.rpPerKill +
                   Math.min(matchData.assists, scoring.kills.killCap - matchData.kills) * scoring.kills.rpPerAssist;
    const cappedKillRP = Math.min(killRP, scoring.kills.killCap * scoring.kills.rpPerKill);
    rpChange += cappedKillRP;
    breakdown.kills = cappedKillRP;

    // Participation RP (uncapped)
    let participationRP = 0;
    participationRP += (matchData.revives || 0) * scoring.participation.rpPerRevive;
    participationRP += (matchData.respawns || 0) * scoring.participation.rpPerRespawn;
    participationRP += (matchData.tacticalUses || 0) * scoring.participation.rpPerScan;
    rpChange += participationRP;
    breakdown.participation = participationRP;

    // Bonuses
    let bonusRP = 0;
    if (matchData.squadWipes) bonusRP += matchData.squadWipes * scoring.bonuses.squadWipeBonus;
    breakdown.bonuses = bonusRP;
    rpChange += bonusRP;

    return { rpChange, breakdown, placementRP, killRP: cappedKillRP, participationRP };
  },

  /**
   * Record a ranked match result. Applies RP change and updates division.
   * @param {string} playerId
   * @param {object} matchData
   * @returns {Promise<object>} { rpChange, newRP, division, tierLabel, breakdown, promoted, demoted }
   */
  async recordMatch(playerId, matchData) {
    const state = await this.getState(playerId);
    const { rpChange, breakdown } = this.calculateRP(matchData, state.rp);

    // Placement match bonus: double RP gains during placement
    let finalRP = rpChange;
    const inPlacement = state.placementMatchesLeft > 0;
    if (inPlacement && finalRP > 0) {
      finalRP = Math.round(finalRP * 2);
    }

    // Win streak bonus
    if (matchData.won) {
      state.winStreak++;
      if (state.winStreak >= 3) finalRP += rankedCfg.scoring.bonuses.winStreak3;
      else if (state.winStreak >= 2) finalRP += rankedCfg.scoring.bonuses.winStreak2;
    } else {
      state.winStreak = 0;
    }

    const oldRP = state.rp;
    const oldDivision = this.getDivision(oldRP);
    state.rp = Math.max(0, state.rp + finalRP);

    // Demotion shield: some divisions prevent dropping below their floor
    if (oldDivision.demotionShield && state.rp < oldDivision.rpFloor) {
      state.rp = oldDivision.rpFloor;
    }

    // Update peak
    if (state.rp > state.peakRP) {
      state.peakRP = state.rp;
      state.peakDivision = this.getDivision(state.rp).id;
    }

    state.matchesPlayed++;
    if (inPlacement) state.placementMatchesLeft--;
    state.lastMatchDate = new Date().toISOString().slice(0, 10);

    // History entry (keep last 10)
    state.history.unshift({
      matchId: matchData.matchId,
      rpChange: finalRP,
      newRP: state.rp,
      placement: matchData.placement,
      kills: matchData.kills,
      timestamp: new Date().toISOString(),
    });
    if (state.history.length > 10) state.history = state.history.slice(0, 10);

    const newDivision = this.getDivision(state.rp);
    const promoted = newDivision.rpFloor > oldDivision.rpFloor;
    const demoted = newDivision.rpFloor < oldDivision.rpFloor;

    await store.set(NS, playerId, state);

    return {
      rpChange: finalRP,
      newRP: state.rp,
      division: newDivision.id,
      divisionName: newDivision.name,
      tierLabel: this.getTierLabel(state.rp, newDivision),
      color: newDivision.color,
      breakdown,
      promoted,
      demoted,
      inPlacement,
      placementMatchesLeft: state.placementMatchesLeft,
      winStreak: state.winStreak,
    };
  },

  /**
   * Get the division definition for a given RP value.
   */
  getDivision(rp) {
    for (let i = rankedCfg.divisions.length - 1; i >= 0; i--) {
      if (rp >= rankedCfg.divisions[i].rpFloor) return rankedCfg.divisions[i];
    }
    return rankedCfg.divisions[0];
  },

  /**
   * Get the tier label (e.g., "Gold II") for a given RP and division.
   */
  getTierLabel(rp, division) {
    if (division.tiers <= 1) return division.name;
    const rpInDiv = rp - division.rpFloor;
    const tierIndex = Math.min(
      Math.floor(rpInDiv / rankedCfg.tierRP.rpPerTier),
      division.tiers - 1
    );
    // Tiers go IV → I (lowest to highest)
    const label = rankedCfg.tierRP.tierLabels[division.tiers - 1 - tierIndex];
    return `${division.name} ${label}`;
  },

  /**
   * Apply inactivity decay (called once daily by a cron job or timer).
   * Only affects Diamond+ players who haven't played within grace period.
   */
  async applyDecay(playerId) {
    if (!rankedCfg.decay.enabled) return null;
    const state = await store.get(NS, playerId);
    if (!state) return null;

    const division = this.getDivision(state.rp);
    const minDecayDiv = rankedCfg.divisions.find(d => d.id === rankedCfg.decay.minimumDivision);
    if (!minDecayDiv || state.rp < minDecayDiv.rpFloor) return null;

    // Check grace period
    if (!state.lastMatchDate) return null;
    const daysSinceMatch = Math.floor((Date.now() - new Date(state.lastMatchDate).getTime()) / 86400000);
    if (daysSinceMatch <= rankedCfg.decay.gracePeriodDays) return null;

    // Apply decay
    const decayDays = daysSinceMatch - rankedCfg.decay.gracePeriodDays;
    const totalDecay = decayDays * rankedCfg.decay.rpPerDay;
    const newRP = Math.max(rankedCfg.decay.floorRP, state.rp - totalDecay);

    if (newRP === state.rp) return null;
    state.rp = newRP;
    await store.set(NS, playerId, state);

    return { playerId, decayed: totalDecay, newRP, division: this.getDivision(newRP).id };
  },

  /**
   * Perform split reset for a player.
   * Retains a fraction of earned RP and resets placement matches.
   */
  async splitReset(playerId) {
    const state = await store.get(NS, playerId);
    if (!state) return;
    state.rp = Math.max(
      rankedCfg.splitReset.minimumRP,
      Math.round(state.rp * rankedCfg.splitReset.retainFraction)
    );
    state.placementMatchesLeft = rankedCfg.splitReset.placementMatches;
    state.split++;
    state.winStreak = 0;
    await store.set(NS, playerId, state);
  },

  /**
   * Get the matchmaking bracket for a player's RP.
   * Used by the matchmaker to group players of similar skill.
   */
  getMatchmakingBracket(rp) {
    const division = this.getDivision(rp);
    for (const bracket of rankedCfg.matchmaking.brackets) {
      if (bracket.divisions.includes(division.id)) return bracket;
    }
    return rankedCfg.matchmaking.brackets[0];
  },

  /**
   * Get ranked summary for display (profile card, lobby, etc.)
   */
  async getSummary(playerId) {
    const state = await this.getState(playerId);
    const division = this.getDivision(state.rp);
    return {
      rp: state.rp,
      peakRP: state.peakRP,
      division: division.id,
      divisionName: division.name,
      tierLabel: this.getTierLabel(state.rp, division),
      color: division.color,
      matchesPlayed: state.matchesPlayed,
      inPlacement: state.placementMatchesLeft > 0,
      placementMatchesLeft: state.placementMatchesLeft,
      winStreak: state.winStreak,
      history: state.history,
    };
  },

  /**
   * Get end-of-season rewards based on peak division.
   */
  async getSeasonRewards(playerId) {
    const state = await this.getState(playerId);
    return rankedCfg.rewards[state.peakDivision] || null;
  },
};

module.exports = Ranked;
