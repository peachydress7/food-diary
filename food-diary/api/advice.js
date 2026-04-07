import { createClient } from '@supabase/supabase-js';
import { rateLimit } from './_rateLimit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ALLOWED_ORIGIN = 'https://food-diary-azure.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const appKey = req.headers['x-app-key'];
  if (!appKey || appKey !== process.env.APP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { user = 'default', days = 7 } = req.body;

  // Fetch entries for the last N days
  const since = new Date();
  since.setDate(since.getDate() - parseInt(days) + 1);
  const sinceStr = since.toISOString().split('T')[0];

  const { data: entries, error } = await supabase
    .from('entries')
    .select('entry_date, calories, protein, carbs, fat, fiber')
    .eq('user_name', user)
    .gte('entry_date', sinceStr)
    .limit(500);

  if (error) return res.status(500).json({ error: error.message });
  if (!entries || entries.length === 0) {
    return res.status(200).json({ advice: null, reason: 'no_data' });
  }

  // Group by date and compute daily totals
  const byDate = {};
  for (const e of entries) {
    if (!byDate[e.entry_date]) byDate[e.entry_date] = { cal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    byDate[e.entry_date].cal     += e.calories || 0;
    byDate[e.entry_date].protein += e.protein  || 0;
    byDate[e.entry_date].carbs   += e.carbs    || 0;
    byDate[e.entry_date].fat     += e.fat      || 0;
    byDate[e.entry_date].fiber   += e.fiber    || 0;
  }

  const dates = Object.values(byDate);
  const n = dates.length;
  const avg = k => Math.round(dates.reduce((s, d) => s + d[k], 0) / n);

  const summary = {
    days: n,
    avgCal:     avg('cal'),
    avgProtein: avg('protein'),
    avgCarbs:   avg('carbs'),
    avgFat:     avg('fat'),
    avgFiber:   avg('fiber'),
  };

  const prompt = `你是一個溫馨、親切的飲食助手。根據使用者最近 ${n} 天的平均飲食資料，給出實用又鼓勵的中文建議。

飲食資料：
- 平均每日熱量：${summary.avgCal} kcal
- 平均蛋白質：${summary.avgProtein} g（建議 50-70g）
- 平均碳水：${summary.avgCarbs} g（建議 225-325g）
- 平均脂肪：${summary.avgFat} g（建議 44-78g）
- 平均膳食纖維：${summary.avgFiber} g（建議 25-38g）

請用溫馨、口語化的語氣回覆，就像朋友在聊天一樣，不要太嚴肅。給出：
1. 值得稱讚的（1-2 句，真誠鼓勵）
2. 建議多攝取的食物或營養素（2-3 句，說明為什麼跟可以吃什麼）
3. 可以稍微注意的（2-3 句，溫和提醒，不要嚇人）

只回傳 JSON，格式：{"praise":"...","more":"...","less":"..."}，不要其他文字。`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await r.json();
  const text = data.content?.[0]?.text?.trim() || '';
  const match = text.match(/\{[\s\S]*\}/);
  const json = JSON.parse(match ? match[0] : text);

  return res.status(200).json({ advice: json, summary });
}
