"""Rate limiting.

Uses Redis sorted sets when Redis is reachable (shared across workers) and
falls back to a process-local sliding window. The fallback is per-process,
which is documented in SECURITY.md — run a single worker or use Redis in
production.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from threading import Lock

log = logging.getLogger(__name__)


class RateLimiter:
    def __init__(self, redis_client=None) -> None:
        self._redis = redis_client
        self._windows: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def _allow_local(self, key: str, limit: int, window: int) -> tuple[bool, int]:
        now = time.monotonic()
        with self._lock:
            q = self._windows[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                retry = int(window - (now - q[0])) + 1
                return False, retry
            q.append(now)
            return True, 0

    def _allow_redis(self, key: str, limit: int, window: int) -> tuple[bool, int] | None:
        if self._redis is None:
            return None
        try:
            now = time.time()
            pipe = self._redis.pipeline()
            pipe.zremrangebyscore(key, 0, now - window)
            pipe.zadd(key, {f"{now:.6f}-{id(pipe)}": now})
            pipe.zcard(key)
            pipe.expire(key, window + 1)
            results = pipe.execute()
            count = results[2]
            if count > limit:
                self._redis.zremrangebyscore(key, now, now + 1)
                return False, window
            return True, 0
        except Exception:  # pragma: no cover - Redis outage
            log.warning("rate limiter falling back to local window (redis unavailable)")
            return None

    def check(self, key: str, limit: int, window_seconds: int = 60) -> tuple[bool, int]:
        result = self._allow_redis(f"rl:{key}", limit, window_seconds)
        if result is not None:
            return result
        return self._allow_local(key, limit, window_seconds)

    def reset(self) -> None:
        with self._lock:
            self._windows.clear()
