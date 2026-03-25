import { createClient } from '@supabase/supabase-js';
import { rateLimit } from './_rateLimit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ALLOWED_ORIGIN = 'https://food-diary-azure.vercel.app';
const MAX_RECORDS = 500;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { method, query, body } = req;

  try {
    if (method === 'GET') {
      // GET /api/entries?date=2025-01-01&user=Max
      const { date, user = 'default' } = query;
      let q = supabase.from('entries').select('*').eq('user_name', user).order('created_at').limit(MAX_RECORDS);
      if (date) q = q.eq('entry_date', date);
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (method === 'POST') {
      // POST /api/entries  body: { entry }
      const { entry, user = 'default' } = body;
      const { data, error } = await supabase.from('entries').insert({
        user_name:  user,
        entry_date: entry.date,
        meal:       entry.meal,
        name:       entry.name,
        calories:   entry.cal || 0,
        portion:    entry.portion || '',
        notes:      entry.notes || '',
        mood:       entry.mood || '😊',
        photos:     entry.photos || [],
        entry_time: entry.time || ''
      }).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (method === 'DELETE') {
      // DELETE /api/entries?id=123
      const { id } = query;
      const { error } = await supabase.from('entries').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
