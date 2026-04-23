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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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
      // GET /api/entries?dateFrom=2025-01-01&dateTo=2025-01-31&user=Max  (batch)
      const { date, dateFrom, dateTo, user = 'default' } = query;
      let q = supabase.from('entries').select('*').eq('user_name', user).order('created_at').limit(MAX_RECORDS);
      if (date) {
        q = q.eq('entry_date', date);
      } else if (dateFrom && dateTo) {
        q = q.gte('entry_date', dateFrom).lte('entry_date', dateTo);
      }
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (method === 'POST') {
      // POST /api/entries  body: { entry }
      const { entry, user = 'default' } = body;
      const baseFields = {
        user_name:  user,
        entry_date: entry.date,
        meal:       entry.meal,
        name:       entry.name,
        calories:   entry.cal || 0,
        portion:    entry.portion || '',
        notes:      entry.notes || '',
        mood:       entry.mood || '😊',
        photos:     entry.photos || [],
        entry_time: entry.time || '',
        meal_id:    entry.meal_id    || null,
        photo_url:  entry.photo_url  || null,
        source:     entry.source     || 'manual',
      };
      const macroFields = {
        protein: entry.protein ?? null,
        carbs:   entry.carbs   ?? null,
        fat:     entry.fat     ?? null,
        fiber:   entry.fiber   ?? null,
      };
      let { data, error } = await supabase.from('entries').insert({ ...baseFields, ...macroFields }).select().single();
      // Fallback: if macro columns don't exist yet, retry without them
      if (error && /column .*(protein|carbs|fat|fiber)/.test(error.message)) {
        ({ data, error } = await supabase.from('entries').insert(baseFields).select().single());
      }
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (method === 'PATCH') {
      // PATCH /api/entries?id=123  body: { entry }
      const { id } = query;
      const { entry } = body;
      const fields = {
        meal:       entry.meal,
        name:       entry.name,
        calories:   entry.cal ?? entry.calories ?? 0,
        portion:    entry.portion || '',
        notes:      entry.notes || '',
        mood:       entry.mood || '😊',
        photos:     entry.photos || [],
        entry_time: entry.time || entry.entry_time || '',
        protein:    entry.protein ?? null,
        carbs:      entry.carbs   ?? null,
        fat:        entry.fat     ?? null,
        fiber:      entry.fiber   ?? null,
      };
      let { data, error } = await supabase.from('entries').update(fields).eq('id', id).select().single();
      if (error && /column .*(protein|carbs|fat|fiber)/.test(error.message)) {
        const { protein, carbs, fat, fiber, ...base } = fields;
        ({ data, error } = await supabase.from('entries').update(base).eq('id', id).select().single());
      }
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
