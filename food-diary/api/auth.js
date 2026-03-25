import { createClient } from '@supabase/supabase-js';
import { rateLimit } from './_rateLimit.js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ALLOWED_ORIGIN = 'https://food-diary-azure.vercel.app';

// SHA256 of 'maxine2026' = 0907d024aaee25a7ce2da51da1910c727e2519f7bcaef3a6a02e84117db9cf43
// Use this to manually set the admin account password_hash in Supabase.
console.log('[auth] sha256(maxine2026)=', crypto.createHash('sha256').update('maxine2026').digest('hex'));

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests.' });
  }

  const { action } = req.query;

  try {
    // ── Register ──
    if (action === 'register' && req.method === 'POST') {
      const { username, display_name, password } = req.body;
      if (!username || !password || !display_name) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      if (!/^[a-zA-Z0-9_]{2,30}$/.test(username)) {
        return res.status(400).json({ error: 'Username must be 2-30 alphanumeric characters or underscores' });
      }
      const { data: existing } = await supabase
        .from('users').select('username').eq('username', username).maybeSingle();
      if (existing) return res.status(409).json({ error: 'Username already taken' });

      const { data, error } = await supabase.from('users').insert({
        username,
        display_name,
        password_hash: hashPassword(password),
        is_admin: false
      }).select('username, display_name, is_admin').single();
      if (error) throw error;
      return res.status(200).json({ ok: true, user: data });
    }

    // ── Login ──
    if (action === 'login' && req.method === 'POST') {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Missing credentials' });
      }
      const { data, error } = await supabase
        .from('users')
        .select('username, display_name, is_admin, password_hash')
        .eq('username', username)
        .single();
      if (error || !data || data.password_hash !== hashPassword(password)) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      const token = `${username}-${Date.now()}`;
      return res.status(200).json({
        ok: true,
        user: { username: data.username, display_name: data.display_name, is_admin: data.is_admin },
        token
      });
    }

    // ── List users (admin) ──
    if (action === 'list' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('users')
        .select('username, display_name')
        .order('username');
      if (error) throw error;
      return res.status(200).json({ users: data });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
