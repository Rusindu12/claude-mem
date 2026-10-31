import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

interface MemoryEntry {
  value: string;
  expiresAt: number | null;
}

export interface RateLimitDecision {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  resetInSeconds: number;
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis | null = null;
  private readonly memStore = new Map<string, MemoryEntry>();
  private readonly memCounters = new Map<string, { count: number; expiresAt: number }>();

  async onModuleInit(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl && redisUrl !== 'embedded') {
      try {
        this.redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 2,
          lazyConnect: true,
          connectTimeout: 4000,
        });
        await this.redis.connect();
        this.logger.log('Connected to Redis cluster via ioredis');
      } catch (err: any) {
        this.logger.warn(
          `Redis connection unavailable (${err?.message}); falling back to embedded in-process cache`,
        );
        if (this.redis) {
          this.redis.disconnect();
          this.redis = null;
        }
      }
    } else {
      this.logger.log('Cache initialized in embedded high-speed memory mode (set REDIS_URL for cluster mode)');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => this.redis?.disconnect());
      this.redis = null;
    }
  }

  isRedisConnected(): boolean {
    return this.redis !== null && this.redis.status === 'ready';
  }

  async get<T = any>(key: string): Promise<T | null> {
    if (this.isRedisConnected()) {
      const raw = await this.redis!.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    }
    const entry = this.memStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.memStore.delete(key);
      return null;
    }
    return JSON.parse(entry.value) as T;
  }

  async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    const serialized = JSON.stringify(value);
    if (this.isRedisConnected()) {
      await this.redis!.set(key, serialized, 'EX', ttlSeconds);
      return;
    }
    this.memStore.set(key, {
      value: serialized,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    if (this.isRedisConnected()) {
      await this.redis!.del(key);
      return;
    }
    this.memStore.delete(key);
  }

  /**
   * Sliding/windowed rate limiter for user quotas, IP abuse prevention, and Business API keys.
   */
  async checkRateLimit(bucketKey: string, limit: number, windowSeconds = 60): Promise<RateLimitDecision> {
    const nowSec = Math.floor(Date.now() / 1000);
    const windowSlot = Math.floor(nowSec / windowSeconds);
    const fullKey = `rl:${bucketKey}:${windowSlot}`;
    const resetInSeconds = windowSeconds - (nowSec % windowSeconds);

    if (this.isRedisConnected()) {
      const count = await this.redis!.incr(fullKey);
      if (count === 1) {
        await this.redis!.expire(fullKey, windowSeconds + 2);
      }
      return {
        allowed: count <= limit,
        current: count,
        limit,
        remaining: Math.max(0, limit - count),
        resetInSeconds,
      };
    }

    const nowMs = Date.now();
    const existing = this.memCounters.get(fullKey);
    let count = 1;
    if (existing && existing.expiresAt > nowMs) {
      existing.count += 1;
      count = existing.count;
    } else {
      this.memCounters.set(fullKey, {
        count: 1,
        expiresAt: nowMs + (windowSeconds + 2) * 1000,
      });
    }
    return {
      allowed: count <= limit,
      current: count,
      limit,
      remaining: Math.max(0, limit - count),
      resetInSeconds,
    };
  }

  /**
   * Acquires a concurrency semaphore slot (used for AI provider concurrency caps & per-user active requests).
   */
  async acquireConcurrencySlot(resourceKey: string, maxConcurrent: number, leaseSeconds = 120): Promise<boolean> {
    const key = `sem:${resourceKey}`;
    if (this.isRedisConnected()) {
      const current = await this.redis!.incr(key);
      if (current === 1) {
        await this.redis!.expire(key, leaseSeconds);
      }
      if (current > maxConcurrent) {
        await this.redis!.decr(key);
        return false;
      }
      return true;
    }

    const nowMs = Date.now();
    const entry = this.memCounters.get(key);
    const active = entry && entry.expiresAt > nowMs ? entry.count : 0;
    if (active >= maxConcurrent) {
      return false;
    }
    this.memCounters.set(key, {
      count: active + 1,
      expiresAt: nowMs + leaseSeconds * 1000,
    });
    return true;
  }

  async releaseConcurrencySlot(resourceKey: string): Promise<void> {
    const key = `sem:${resourceKey}`;
    if (this.isRedisConnected()) {
      const val = await this.redis!.decr(key);
      if (val < 0) await this.redis!.set(key, '0', 'EX', 10);
      return;
    }
    const entry = this.memCounters.get(key);
    if (entry) {
      entry.count = Math.max(0, entry.count - 1);
    }
  }
}
