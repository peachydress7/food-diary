import { createClient } from '@supabase/supabase-js';
import { rateLimit } from './_rateLimit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ALLOWED_ORIGIN = 'https://food-diary-azure.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { method, query, body } = req;

  try {
    if (method === 'GET') {
      // GET /api/weight?user=xxx&days=30
      const { user = 'default', days = 30 } = query;
      const since = new Date();
      since.setDate(since.getDate() - parseInt(days) + 1);
      const { data, error } = await supabase
        .from('weight_logs')
        .select('*')
        .eq('user_name', user)
        .gte('log_date', since.toISOString().split('T')[0])
        .order('log_date', { ascending: true })
        .limit(500);
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (method === 'POST') {
      // POST /api/weight  body: { user, date, weight, note }
      const { user = 'default', date, weight, note = '' } = body;
      if (!weight || isNaN(parseFloat(weight))) {
        return res.status(400).json({ error: 'Invalid weight' });
      }
      const { data, error } = await supabase
        .from('weight_logs')
        .insert({ user_name: user, log_date: date, weight: parseFloat(weight), note })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (method === 'DELETE') {
      // DELETE /api/weight?id=xxx
      const { id } = query;
      const { error } = await supabase.from('weight_logs').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
