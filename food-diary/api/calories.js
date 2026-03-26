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
      max_tokens: 120,
      messages: [{ role: 'user', content: `估算這個食物的營養成分。食物：${name}${portion ? '，份量：' + portion : ''}。只回傳 JSON，格式：{"calories":數字,"protein":數字,"carbs":數字,"fat":數字,"fiber":數字}，所有數字都是整數，不要任何其他文字。` }]
    })
  });
  const data = await r.json();
  const text = data.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  const json = JSON.parse(match ? match[0] : text);
  return res.status(200).json({
    calories: parseInt(json.calories) || 0,
    protein:  parseInt(json.protein)  || 0,
    carbs:    parseInt(json.carbs)    || 0,
    fat:      parseInt(json.fat)      || 0,
    fiber:    parseInt(json.fiber)    || 0,
  });
}
