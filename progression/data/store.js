/**
 * data/store.js
 * ═══════════════════════════════════════════════════════════════════════
 * Persistence abstraction layer.
 *
 * Currently: in-memory Maps (development / testing)
 * Production: swap implementation to Redis, Postgres, or DynamoDB
 *             without changing any service code.
 *
 * Every service calls store.get/set/delete/list — never touches
 * the underlying storage directly.
 * ═══════════════════════════════════════════════════════════════════════
 */

class Store {
  constructor() {
    /** @type {Map<string, Map<string, any>>} namespace → key → value */
    this._data = new Map();
  }

  /**
   * Get a value by namespace and key.
   * @param {string} ns — namespace (e.g., 'accounts', 'stats', 'challenges')
   * @param {string} key — unique key within namespace
   * @returns {any|null}
   */
  async get(ns, key) {
    return this._data.get(ns)?.get(key) ?? null;
  }

  /**
   * Set a value. Creates namespace if needed.
   * @returns {boolean} true on success
   */
  async set(ns, key, value) {
    if (!this._data.has(ns)) this._data.set(ns, new Map());
    this._data.get(ns).set(key, structuredClone(value));
    return true;
  }

  /**
   * Delete a key from a namespace.
   * @returns {boolean} true if key existed
   */
  async delete(ns, key) {
    return this._data.get(ns)?.delete(key) ?? false;
  }

  /**
   * List all keys in a namespace, optionally filtered by prefix.
   * @param {string} ns
   * @param {string} [prefix]
   * @returns {string[]}
   */
  async list(ns, prefix = '') {
    const map = this._data.get(ns);
    if (!map) return [];
    const keys = [...map.keys()];
    return prefix ? keys.filter(k => k.startsWith(prefix)) : keys;
  }

  /**
   * Get multiple keys at once.
   * @returns {Map<string, any>}
   */
  async getMany(ns, keys) {
    const result = new Map();
    const map = this._data.get(ns);
    if (!map) return result;
    for (const k of keys) {
      if (map.has(k)) result.set(k, structuredClone(map.get(k)));
    }
    return result;
  }

  /**
   * Atomic increment of a numeric field inside a stored object.
   * Creates the object with { [field]: amount } if it doesn't exist.
   */
  async increment(ns, key, field, amount = 1) {
    let obj = await this.get(ns, key);
    if (!obj) obj = {};
    obj[field] = (obj[field] || 0) + amount;
    await this.set(ns, key, obj);
    return obj[field];
  }

  /** Get total number of keys in a namespace */
  async count(ns) {
    return this._data.get(ns)?.size ?? 0;
  }

  /** Wipe all data (testing only) */
  async flush() {
    this._data.clear();
  }
}

module.exports = new Store();
