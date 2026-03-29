/**
 * services/cosmetics.js
 * ═══════════════════════════════════════════════════════════════════════
 * Cosmetics registry and unlock management.
 *
 * This service is a placeholder-hook architecture: it defines the
 * data structures, lookup methods, and equip/unlock flows that
 * the client and server use, but does NOT contain actual art assets.
 *
 * Content creators add cosmetics by extending REGISTRY. The service
 * handles unlock tracking, equip validation, and inventory queries.
 * ═══════════════════════════════════════════════════════════════════════
 */

const store = require('../data/store');

/**
 * Cosmetics registry. Each item has a unique ID, type, rarity, and
 * metadata for the client renderer. Extend this object to add content.
 *
 * Types: 'skin', 'banner', 'badge', 'quip', 'trail', 'emote'
 * Rarity: 'common', 'rare', 'epic', 'legendary'
 */
const REGISTRY = {
  // ── Hero skins ──
  skin_forge_default:     { type: 'skin', hero: 'forge',    rarity: 'common',    name: 'Standard Issue',    defaultUnlocked: true },
  skin_forge_tactical:    { type: 'skin', hero: 'forge',    rarity: 'rare',      name: 'Tactical Ops' },
  skin_forge_inferno:     { type: 'skin', hero: 'forge',    rarity: 'legendary', name: 'Inferno' },
  skin_wraith_default:    { type: 'skin', hero: 'wraith',   rarity: 'common',    name: 'Standard Issue',    defaultUnlocked: true },
  skin_wraith_spectral:   { type: 'skin', hero: 'wraith',   rarity: 'rare',      name: 'Spectral' },
  skin_wraith_voidwalker: { type: 'skin', hero: 'wraith',   rarity: 'legendary', name: 'Voidwalker' },
  skin_seer_default:      { type: 'skin', hero: 'seer',     rarity: 'common',    name: 'Standard Issue',    defaultUnlocked: true },
  skin_seer_oracle:       { type: 'skin', hero: 'seer',     rarity: 'epic',      name: 'Oracle' },
  skin_lifeline_default:  { type: 'skin', hero: 'lifeline', rarity: 'common',    name: 'Standard Issue',    defaultUnlocked: true },
  skin_lifeline_medic:    { type: 'skin', hero: 'lifeline', rarity: 'rare',      name: 'Field Medic' },
  skin_catalyst_default:  { type: 'skin', hero: 'catalyst', rarity: 'common',    name: 'Standard Issue',    defaultUnlocked: true },
  skin_catalyst_ferrous:  { type: 'skin', hero: 'catalyst', rarity: 'epic',      name: 'Ferrous' },
  skin_ranked_diamond_s1: { type: 'skin', hero: '*',        rarity: 'epic',      name: 'Diamond Ranked S1', source: 'ranked' },
  skin_ranked_master_s1:  { type: 'skin', hero: '*',        rarity: 'legendary', name: 'Master Ranked S1',  source: 'ranked' },
  skin_ranked_pred_s1:    { type: 'skin', hero: '*',        rarity: 'legendary', name: 'Predator Ranked S1',source: 'ranked' },

  // ── Banners ──
  banner_rookie:          { type: 'banner', rarity: 'common',    name: 'Rookie' },
  banner_veteran:         { type: 'banner', rarity: 'rare',      name: 'Veteran' },
  banner_premium_s1:      { type: 'banner', rarity: 'epic',      name: 'Season 1 Premium' },
  banner_animated_s1:     { type: 'banner', rarity: 'legendary', name: 'Season 1 Animated' },
  banner_ranked_gold_s1:  { type: 'banner', rarity: 'rare',      name: 'Gold Ranked S1',    source: 'ranked' },
  banner_ranked_plat_s1:  { type: 'banner', rarity: 'epic',      name: 'Platinum Ranked S1', source: 'ranked' },
  banner_ranked_diamond_s1:{ type: 'banner', rarity: 'epic',     name: 'Diamond Ranked S1', source: 'ranked' },
  banner_ranked_master_s1: { type: 'banner', rarity: 'legendary',name: 'Master Ranked S1',  source: 'ranked' },
  banner_ranked_pred_s1:   { type: 'banner', rarity: 'legendary',name: 'Predator Ranked S1',source: 'ranked' },

  // ── Badges ──
  badge_s1_5:             { type: 'badge', rarity: 'common', name: 'Season 1 — Level 5' },
  badge_s1_30:            { type: 'badge', rarity: 'rare',   name: 'Season 1 — Level 30' },
  badge_s1_70:            { type: 'badge', rarity: 'epic',   name: 'Season 1 — Level 70' },
  badge_s1_100:           { type: 'badge', rarity: 'legendary', name: 'Season 1 — Level 100' },
  badge_s1_prestige_1:    { type: 'badge', rarity: 'legendary', name: 'Season 1 Prestige' },
  badge_ranked_bronze_s1: { type: 'badge', rarity: 'common', name: 'Bronze Ranked S1' },
  badge_ranked_silver_s1: { type: 'badge', rarity: 'common', name: 'Silver Ranked S1' },
  badge_ranked_gold_s1:   { type: 'badge', rarity: 'rare',   name: 'Gold Ranked S1' },
  badge_ranked_plat_s1:   { type: 'badge', rarity: 'epic',   name: 'Platinum Ranked S1' },
  badge_ranked_diamond_s1:{ type: 'badge', rarity: 'epic',   name: 'Diamond Ranked S1' },
  badge_ranked_master_s1: { type: 'badge', rarity: 'legendary', name: 'Master Ranked S1' },
  badge_ranked_pred_s1:   { type: 'badge', rarity: 'legendary', name: 'Predator Ranked S1' },

  // ── Quips (voice/text lines) ──
  quip_forge_1:           { type: 'quip', hero: 'forge',    rarity: 'rare', name: 'Locked and loaded' },
  quip_seer_1:            { type: 'quip', hero: 'seer',     rarity: 'rare', name: 'I see everything' },
  quip_wraith_1:          { type: 'quip', hero: 'wraith',   rarity: 'rare', name: 'There is no escape' },

  // ── Dive trails ──
  trail_pred_s1:          { type: 'trail', rarity: 'legendary', name: 'Predator Trail S1', source: 'ranked' },

  // ── XP boosts ──
  xp_boost_10pct:         { type: 'xp_boost', rarity: 'rare', name: '10% XP Boost', boostPercent: 10 },
  xp_boost_25pct:         { type: 'xp_boost', rarity: 'epic', name: '25% XP Boost', boostPercent: 25 },

  // ── Loot boxes ──
  loot_box_rare:          { type: 'loot_box', rarity: 'rare',      name: 'Rare Pack' },
  loot_box_epic:          { type: 'loot_box', rarity: 'epic',      name: 'Epic Pack' },
  loot_box_legendary:     { type: 'loot_box', rarity: 'legendary', name: 'Legendary Pack' },
};

const Cosmetics = {
  /** Get an item definition by ID */
  getItem(itemId) {
    return REGISTRY[itemId] ? { id: itemId, ...REGISTRY[itemId] } : null;
  },

  /** Get all items of a specific type */
  getByType(type) {
    return Object.entries(REGISTRY)
      .filter(([, v]) => v.type === type)
      .map(([k, v]) => ({ id: k, ...v }));
  },

  /** Get all items for a specific hero */
  getByHero(heroId) {
    return Object.entries(REGISTRY)
      .filter(([, v]) => v.hero === heroId || v.hero === '*')
      .map(([k, v]) => ({ id: k, ...v }));
  },

  /** Check if a player has unlocked an item */
  async isUnlocked(playerId, itemId) {
    const profile = await store.get('accounts', playerId);
    if (!profile) return false;
    const item = REGISTRY[itemId];
    if (item?.defaultUnlocked) return true;
    return profile.unlocks?.includes(itemId) || false;
  },

  /** Get all unlocked items for a player */
  async getUnlocked(playerId) {
    const profile = await store.get('accounts', playerId);
    if (!profile) return [];
    // Start with default-unlocked items
    const defaults = Object.entries(REGISTRY)
      .filter(([, v]) => v.defaultUnlocked)
      .map(([k]) => k);
    const all = new Set([...defaults, ...(profile.unlocks || [])]);
    return [...all].map(id => ({ id, ...REGISTRY[id] })).filter(i => i.type);
  },

  /** Equip an item (validates ownership) */
  async equip(playerId, slot, itemId) {
    const unlocked = await this.isUnlocked(playerId, itemId);
    if (!unlocked) return { success: false, reason: 'Item not unlocked' };

    const profile = await store.get('accounts', playerId);
    if (!profile) return { success: false, reason: 'Account not found' };
    const item = REGISTRY[itemId];
    if (!item) return { success: false, reason: 'Item not found' };

    // Validate slot matches item type
    switch (item.type) {
      case 'skin':
        if (!item.hero) return { success: false, reason: 'Invalid skin' };
        profile.equipped.skin[item.hero === '*' ? '_universal' : item.hero] = itemId;
        break;
      case 'banner':
        profile.equipped.banner = itemId;
        break;
      case 'badge':
        // slot is the badge slot index (0-2)
        if (typeof slot !== 'number' || slot < 0 || slot > 2) return { success: false, reason: 'Invalid badge slot' };
        profile.equipped.badge[slot] = itemId;
        break;
      case 'quip':
        if (item.hero) profile.equipped.quip[item.hero] = itemId;
        break;
      case 'trail':
        profile.equipped.trail = itemId;
        break;
      default:
        return { success: false, reason: 'Item type not equippable' };
    }

    await store.set('accounts', playerId, profile);
    return { success: true };
  },

  /** Get the full registry (for client-side rendering lookup) */
  getRegistry() { return REGISTRY; },
};

module.exports = Cosmetics;
