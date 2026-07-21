/**
 * Lightweight in-memory rate limiter for MCP endpoints.
 */
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 60;

/** @type {Map<string, { count: number, resetAt: number }>} */
const buckets = new Map();

function clientKey(req) {
  const wid = String(req.workspaceId || 'unknown');
  const ip = String(
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown',
  );
  return `${wid}:${ip}`;
}

function mcpRateLimit(req, res, next) {
  const key = clientKey(req);
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  res.setHeader('X-RateLimit-Limit', String(MAX_REQUESTS));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - bucket.count)));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > MAX_REQUESTS) {
    return res.status(429).json({
      jsonrpc: '2.0',
      error: {
        code: -32029,
        message: 'Rate limit exceeded. Try again in a minute.',
      },
    });
  }
  return next();
}

module.exports = { mcpRateLimit, MAX_REQUESTS, WINDOW_MS };
