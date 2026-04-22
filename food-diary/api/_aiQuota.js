import { createClient } from '@supabase/supabase-js';
import { AI_CONFIG, getTaipeiDayBounds } from './_aiConfig.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

/**
 * Check whether a user is allowed to make an AI call.
 * Returns { allowed, used, limit, resetAt, reason? }
 */
export async function checkUserQuota(userId) {
  // Admins have unlimited access
  if (AI_CONFIG.adminUserIds.includes(userId)) {
    return { allowed: true, used: 0, limit: Infinity, resetAt: new Date(), unlimited: true };
  }

  const { startOfDay, endOfDay, resetAt } = getTaipeiDayBounds();

  // Count today's successful calls for this user
  const { count: userCount, error: userErr } = await supabase
    .from('ai_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('success', true)
    .gte('used_at', startOfDay.toISOString())
    .lt('used_at', endOfDay.toISOString());

  if (userErr) throw new Error('Quota check failed: ' + userErr.message);

  // Count today's successful calls globally
  const { count: globalCount, error: globalErr } = await supabase
    .from('ai_usage')
    .select('*', { count: 'exact', head: true })
    .eq('success', true)
    .gte('used_at', startOfDay.toISOString())
    .lt('used_at', endOfDay.toISOString());

  if (globalErr) throw new Error('Global quota check failed: ' + globalErr.message);

  const used  = userCount  ?? 0;
  const limit = AI_CONFIG.dailyLimitPerUser;

  if (used >= limit) {
    return { allowed: false, used, limit, resetAt, reason: 'user_limit' };
  }
  if ((globalCount ?? 0) >= AI_CONFIG.dailyLimitGlobal) {
    return { allowed: false, used, limit, resetAt, reason: 'global_limit' };
  }

  return { allowed: true, used, limit, resetAt };
}

/**
 * Record an AI call result into ai_usage table.
 * Call this after every attempt (success or failure).
 */
export async function recordUsage({ userId, success, inputTokens, outputTokens, errorReason }) {
  const costUsd = success
    ? (inputTokens  || 0) * AI_CONFIG.inputCostPerMillion  / 1_000_000
    + (outputTokens || 0) * AI_CONFIG.outputCostPerMillion / 1_000_000
    : 0;

  const { error } = await supabase.from('ai_usage').insert({
    user_id:       userId,
    success:       success,
    input_tokens:  inputTokens  ?? null,
    output_tokens: outputTokens ?? null,
    cost_usd:      costUsd || null,
    model:         AI_CONFIG.model,
    error_reason:  errorReason ?? null,
  });

  if (error) console.error('[ai_usage] record failed:', error.message);
}
