export const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sliding-window limiter shared by every portal call.
 *
 * Callers are served strictly in order. `pause()` lets the client back everyone off
 * after a 429, since the portal sends no Retry-After header.
 */
export class RateLimiter {
  #stamps = [];
  #queue = Promise.resolve();
  #pausedUntil = 0;

  constructor(limit, windowMs, now = Date.now, sleep = realSleep) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.sleep = sleep;
  }

  acquire() {
    const turn = this.#queue.then(() => this.#waitForSlot());
    this.#queue = turn.catch(() => undefined);
    return turn;
  }

  pause(ms) {
    this.#pausedUntil = Math.max(this.#pausedUntil, this.now() + ms);
  }

  async #waitForSlot() {
    for (;;) {
      const t = this.now();
      if (t < this.#pausedUntil) {
        await this.sleep(this.#pausedUntil - t);
        continue;
      }
      while (this.#stamps.length > 0 && t - this.#stamps[0] >= this.windowMs) this.#stamps.shift();
      if (this.#stamps.length < this.limit) {
        this.#stamps.push(t);
        return;
      }
      await this.sleep(this.windowMs - (t - this.#stamps[0]) + 1);
    }
  }
}
