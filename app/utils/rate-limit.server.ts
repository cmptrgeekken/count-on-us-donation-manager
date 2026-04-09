type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function buildHeaders({
  limit,
  remaining,
  retryAfterSeconds,
}: {
  limit: number;
  remaining: number;
  retryAfterSeconds?: number;
}) {
  const headers = new Headers();
  headers.set("X-RateLimit-Limit", String(limit));
  headers.set("X-RateLimit-Remaining", String(Math.max(remaining, 0)));

  if (retryAfterSeconds !== undefined) {
    headers.set("Retry-After", String(Math.max(retryAfterSeconds, 1)));
  }

  return headers;
}

export function checkRateLimit({ key, limit, windowMs, now = Date.now() }: RateLimitOptions) {
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt,
      headers: buildHeaders({ limit, remaining: limit - 1 }),
    };
  }

  if (existing.count >= limit) {
    const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      headers: buildHeaders({ limit, remaining: 0, retryAfterSeconds }),
    };
  }

  existing.count += 1;
  buckets.set(key, existing);

  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
    headers: buildHeaders({ limit, remaining: limit - existing.count }),
  };
}

export function resetRateLimitBuckets() {
  buckets.clear();
}
