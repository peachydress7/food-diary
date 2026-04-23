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
      // GET /api/water?date=2025-01-01&user=xxx
      const { date, user = 'default' } = query;
      if (!date) return res.status(400).json({ error: 'Missing date' });
      const { data, error } = await supabase
        .from('water')
        .select('*')
        .eq('user_name', user)
        .eq('entry_date', date)
        .order('created_at');
      if (error) throw error;
      res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=30');
      return res.status(200).json(data);
    }

    if (method === 'POST') {
      // POST /api/water  body: { user, date, amount_ml }
      const { user = 'default', date, amount_ml } = body;
      if (!date || !amount_ml) return res.status(400).json({ error: 'Missing fields' });
      const { data, error } = await supabase
        .from('water')
        .insert({ user_name: user, entry_date: date, amount_ml: parseInt(amount_ml) })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (method === 'DELETE') {
      // DELETE /api/water?id=xxx
      const { id } = query;
      const { error } = await supabase.from('water').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
