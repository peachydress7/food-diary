import { createClient } from '@supabase/supabase-js';
import { rateLimit } from './_rateLimit.js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ALLOWED_ORIGIN = 'https://food-diary-azure.vercel.app';

// SHA256 of 'maxine2026' = 0907d024aaee25a7ce2da51da1910c727e2519f7bcaef3a6a02e84117db9cf43
console.log('[auth] sha256(maxine2026)=', crypto.createHash('sha256').update('maxine2026').digest('hex'));

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
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

  // Safe body parsing — Vercel should auto-parse JSON, but guard just in case
  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  try {
    // ── Register ──
    if (action === 'register' && req.method === 'POST') {
      const { username, display_name, password } = body;

      if (!username || !password || !display_name) {
        return res.status(400).json({ error: '請填寫所有欄位（用戶名、顯示名稱、密碼）' });
      }
      if (!/^[a-zA-Z0-9_]{2,30}$/.test(username)) {
        return res.status(400).json({ error: '用戶名只能包含英文、數字或底線，長度 2-30 字元' });
      }
      if (String(password).length < 4) {
        return res.status(400).json({ error: '密碼至少需要 4 個字元' });
      }

      // Check for existing username — use limit(1) to avoid maybeSingle multi-row edge case
      const { data: existingRows, error: checkErr } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .limit(1);

      if (checkErr) {
        console.error('[auth] register check error:', checkErr);
        return res.status(500).json({ error: '資料庫查詢失敗：' + checkErr.message });
      }
      if (existingRows && existingRows.length > 0) {
        return res.status(409).json({ error: '此用戶名已被使用，請換一個' });
      }

      const { data, error } = await supabase
        .from('users')
        .insert({
          username,
          display_name,
          password_hash: hashPassword(password),
          is_admin: false
        })
        .select('username, display_name, is_admin')
        .single();

      if (error) {
        console.error('[auth] register insert error:', error);
        return res.status(500).json({ error: '註冊失敗：' + error.message });
      }

      // Return token so frontend can auto-login immediately after register
      const token = `${username}-${Date.now()}`;
      return res.status(200).json({ ok: true, user: data, token });
    }

    // ── Login ──
    if (action === 'login' && req.method === 'POST') {
      const { username, password } = body;

      if (!username || !password) {
        return res.status(400).json({ error: '請填寫用戶名和密碼' });
      }

      // Use maybeSingle: returns null (not an error) when 0 rows found
      const { data, error } = await supabase
        .from('users')
        .select('username, display_name, is_admin, password_hash')
        .eq('username', username)
        .maybeSingle();

      if (error) {
        console.error('[auth] login query error:', error);
        return res.status(500).json({ error: '登入查詢失敗：' + error.message });
      }
      if (!data) {
        return res.status(401).json({ error: '用戶名不存在' });
      }
      if (data.password_hash !== hashPassword(password)) {
        return res.status(401).json({ error: '密碼錯誤' });
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
      if (error) {
        console.error('[auth] list error:', error);
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ users: data });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (err) {
    console.error('[auth] unexpected error:', err);
    return res.status(500).json({ error: '伺服器錯誤：' + err.message });
  }
}
