const requests = new Map();

/**
 * Simple in-memory rate limiter.
 * Returns true if the request is allowed, false if it exceeds the limit.
 * Note: resets per serverless instance; best-effort in multi-instance deployments.
 */
export function rateLimit(ip, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  let entry = requests.get(ip);
  if (!entry || now > entry.reset) {
    entry = { count: 0, reset: now + windowMs };
  }
  entry.count++;
  requests.set(ip, entry);
  return entry.count <= limit;
}
