import { Injectable } from '@nestjs/common';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

interface Entry {
  count: number;
  windowStart: number;
}

/**
 * Rate limit en memoria para solicitudes de ingreso (~10/min por IP).
 * Mecanismo de desarrollo, no anti-DDoS: no comparte estado entre instancias.
 */
@Injectable()
export class JoinRequestRateLimiter {
  private readonly entries = new Map<string, Entry>();

  consume(key: string): boolean {
    const now = Date.now();
    let entry = this.entries.get(key);
    if (!entry || now - entry.windowStart >= WINDOW_MS) {
      entry = { count: 0, windowStart: now };
      this.entries.set(key, entry);
    }
    entry.count += 1;
    if (this.entries.size > 10000) {
      this.entries.clear();
    }
    return entry.count <= MAX_PER_WINDOW;
  }

  reset(): void {
    this.entries.clear();
  }
}
