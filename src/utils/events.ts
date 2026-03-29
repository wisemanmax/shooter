/**
 * Event Bus — typed pub/sub system extracted from v6 `Ev` object (line 146).
 * Provides decoupled communication between game systems.
 */

type EventHandler = (data: any) => void;

export class EventBus {
  private listeners: Map<string, EventHandler[]> = new Map();

  /** Register an event listener */
  on(event: string, handler: EventHandler): void {
    const list = this.listeners.get(event);
    if (list) {
      list.push(handler);
    } else {
      this.listeners.set(event, [handler]);
    }
  }

  /** Emit an event to all listeners */
  emit(event: string, data?: any): void {
    const list = this.listeners.get(event);
    if (!list) return;
    for (const handler of list) {
      handler(data);
    }
  }

  /** Remove a listener */
  off(event: string, handler: EventHandler): void {
    const list = this.listeners.get(event);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
  }
}

/** Global event bus singleton */
export const Ev = new EventBus();
