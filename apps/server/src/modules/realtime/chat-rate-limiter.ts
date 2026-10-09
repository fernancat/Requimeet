import { Injectable } from '@nestjs/common';

const CAPACITY = 5;
const REFILL_PER_MS = 5 / 2000;

interface Bucket {
  tokens: number;
  lastRefill: number;
}

/** Token bucket en memoria por participante: ~5 mensajes / 2s. */
@Injectable()
export class ChatRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  consume(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: CAPACITY, lastRefill: now };
      this.buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(
      CAPACITY,
      bucket.tokens + (now - bucket.lastRefill) * REFILL_PER_MS,
    );
    bucket.lastRefill = now;
    if (bucket.tokens < 1) {
      return false;
    }
    bucket.tokens -= 1;
    if (this.buckets.size > 10000) {
      this.buckets.clear();
    }
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }
}
