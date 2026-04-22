import { rateLimit } from './_rateLimit.js';
import { checkUserQuota } from './_aiQuota.js';

const ALLOWED_ORIGIN = 'https://food-diary-azure.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key, x-username');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const appKey = req.headers['x-app-key'];
  if (!appKey || appKey !== process.env.APP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(ip)) return res.status(429).json({ error: 'Too many requests' });

  const userId = req.headers['x-username'] || '';
  if (!userId) return res.status(400).json({ error: '需要登入才能查詢額度' });

  try {
    const quota = await checkUserQuota(userId);
    return res.status(200).json({
      used:      quota.used,
      limit:     quota.unlimited ? null : quota.limit,
      remaining: quota.unlimited ? null : Math.max(0, quota.limit - quota.used),
      reset_at:  quota.resetAt.toISOString(),
      unlimited: quota.unlimited || false,
    });
  } catch (e) {
    console.error('[ai-quota]', e);
    return res.status(500).json({ error: e.message });
  }
}
