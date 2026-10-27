import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/portal/rateLimiter.js';

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

describe('RateLimiter', () => {
  it('lets `limit` calls through per window, then waits for the oldest to expire', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(3, 60_000, clock.now, clock.sleep);
    const times = [];
    for (let i = 0; i < 5; i++) {
      await limiter.acquire();
      times.push(clock.now());
    }
    expect(times.slice(0, 3)).toEqual([0, 0, 0]);
    expect(times[3]).toBeGreaterThanOrEqual(60_000);
  });

  it('holds everyone back after pause()', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(100, 60_000, clock.now, clock.sleep);
    limiter.pause(5_000);
    await limiter.acquire();
    expect(clock.now()).toBe(5_000);
  });
});
