/**
 * Generic object pool for performance-critical allocations.
 * Pre-allocates objects and recycles them to avoid GC pressure.
 */

export class ObjectPool<T> {
  private pool: T[] = [];
  private active: Set<T> = new Set();

  /**
   * Create an object pool.
   * @param factory - Function that creates a new instance of T
   * @param reset - Function that resets an instance to its initial state
   * @param initialSize - Number of objects to pre-allocate
   */
  constructor(
    private factory: () => T,
    private reset: (item: T) => void,
    initialSize: number
  ) {
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factory());
    }
  }

  /** Get an item from the pool, creating one if the pool is empty */
  acquire(): T {
    let item: T;
    if (this.pool.length > 0) {
      item = this.pool.pop()!;
    } else {
      item = this.factory();
    }
    this.active.add(item);
    return item;
  }

  /** Return an item to the pool after resetting it */
  release(item: T): void {
    if (!this.active.has(item)) return;
    this.active.delete(item);
    this.reset(item);
    this.pool.push(item);
  }

  /** Number of currently active (checked-out) items */
  get activeCount(): number {
    return this.active.size;
  }
}
