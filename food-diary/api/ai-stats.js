import { createClient } from '@supabase/supabase-js';
import { rateLimit } from './_rateLimit.js';
import { AI_CONFIG, getTaipeiDayBounds } from './_aiConfig.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);
const ALLOWED_ORIGIN = 'https://food-diary-azure.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key, x-username');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Auth
  if (req.headers['x-app-key'] !== process.env.APP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(ip)) return res.status(429).json({ error: 'Too many requests' });

  const userId = (req.headers['x-username'] || '').trim();
  if (!AI_CONFIG.adminUserIds.includes(userId)) {
    return res.status(403).json({ error: '沒有管理員權限' });
  }

  try {
    const { startOfDay, endOfDay } = getTaipeiDayBounds();

    // ── Today summary ──
    const { data: todayRows } = await supabase
      .from('ai_usage')
      .select('success, cost_usd, error_reason, user_id')
      .gte('used_at', startOfDay.toISOString())
      .lt('used_at', endOfDay.toISOString());

    const todayTotal   = todayRows?.length || 0;
    const todaySuccess = todayRows?.filter(r => r.success).length || 0;
    const todayFail    = todayTotal - todaySuccess;
    const todayCost    = todayRows?.reduce((s, r) => s + (parseFloat(r.cost_usd) || 0), 0) || 0;

    // ── This month ──
    const now = new Date();
    const taipeiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const monthStart = new Date(Date.UTC(taipeiNow.getFullYear(), taipeiNow.getMonth(), 1) - 8 * 3600 * 1000);

    const { data: monthRows } = await supabase
      .from('ai_usage')
      .select('success, cost_usd, used_at')
      .gte('used_at', monthStart.toISOString());

    const monthTotal   = monthRows?.length || 0;
    const monthSuccess = monthRows?.filter(r => r.success).length || 0;
    const monthCost    = monthRows?.reduce((s, r) => s + (parseFloat(r.cost_usd) || 0), 0) || 0;

    // Daily trend (last 14 days)
    const dailyMap = {};
    monthRows?.forEach(r => {
      const d = new Date(r.used_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
      if (!dailyMap[d]) dailyMap[d] = { calls: 0, cost: 0 };
      dailyMap[d].calls++;
      dailyMap[d].cost += parseFloat(r.cost_usd) || 0;
    });
    const dailyTrend = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, v]) => ({ date, calls: v.calls, cost: parseFloat(v.cost.toFixed(6)) }));

    // Estimated monthly cost (pro-rate)
    const dayOfMonth = taipeiNow.getDate();
    const daysInMonth = new Date(taipeiNow.getFullYear(), taipeiNow.getMonth() + 1, 0).getDate();
    const estimatedMonthCost = dayOfMonth > 0 ? (monthCost / dayOfMonth) * daysInMonth : 0;

    // ── Top 10 users today ──
    const userMap = {};
    todayRows?.filter(r => r.success).forEach(r => {
      if (!userMap[r.user_id]) userMap[r.user_id] = { calls: 0, cost: 0 };
      userMap[r.user_id].calls++;
      userMap[r.user_id].cost += parseFloat(r.cost_usd) || 0;
    });
    const topUsers = Object.entries(userMap)
      .sort(([, a], [, b]) => b.calls - a.calls)
      .slice(0, 10)
      .map(([user_id, v]) => ({ user_id, calls: v.calls, cost: parseFloat(v.cost.toFixed(6)) }));

    // ── Recent 20 errors ──
    const { data: recentErrors } = await supabase
      .from('ai_usage')
      .select('user_id, used_at, error_reason')
      .eq('success', false)
      .order('used_at', { ascending: false })
      .limit(20);

    return res.status(200).json({
      today: {
        total: todayTotal, success: todaySuccess, fail: todayFail,
        cost_usd: parseFloat(todayCost.toFixed(6)),
      },
      month: {
        total: monthTotal, success: monthSuccess,
        cost_usd: parseFloat(monthCost.toFixed(4)),
        estimated_month_cost_usd: parseFloat(estimatedMonthCost.toFixed(4)),
        daily_trend: dailyTrend,
      },
      top_users: topUsers,
      recent_errors: (recentErrors || []).map(r => ({
        user_id: r.user_id,
        used_at: r.used_at,
        error_reason: r.error_reason,
      })),
    });

  } catch (e) {
    console.error('[ai-stats]', e);
    return res.status(500).json({ error: e.message });
  }
}
