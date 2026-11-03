export class RateLimiter {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly maxEvents: number,
    private readonly windowMs: number,
  ) {}

  allow(now: number): boolean {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0) {
      const first = this.timestamps[0];
      if (first === undefined || first > cutoff) {
        break;
      }
      this.timestamps.shift();
    }

    if (this.timestamps.length >= this.maxEvents) {
      return false;
    }

    this.timestamps.push(now);
    return true;
  }
}
