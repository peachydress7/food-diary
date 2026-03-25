import { rateLimit } from './_rateLimit.js';

const ALLOWED_ORIGIN = 'https://food-diary-azure.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // App key verification
  const appKey = req.headers['x-app-key'];
  if (!appKey || appKey !== process.env.APP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { name, portion } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing food name' });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [{ role: 'user', content: `這個食物的熱量是多少kcal？食物：${name}${portion ? '，份量：' + portion : ''}。只回傳數字，不要任何其他文字。` }]
    })
  });
  const data = await r.json();
  const calories = parseInt(data.content[0].text.trim());
  return res.status(200).json({ calories });
}
