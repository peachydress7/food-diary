// Centralized AI configuration — reads from env vars with safe fallbacks
export const AI_CONFIG = {
  geminiApiKey:        process.env.GEMINI_API_KEY || '',
  dailyLimitPerUser:   parseInt(process.env.AI_DAILY_LIMIT_PER_USER  || '5'),
  dailyLimitGlobal:    parseInt(process.env.AI_DAILY_LIMIT_GLOBAL    || '200'),
  adminUserIds:        (process.env.AI_ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
  model:               'gemini-2.5-flash',
  inputCostPerMillion:  0.30,   // USD per 1M input tokens
  outputCostPerMillion: 2.50,   // USD per 1M output tokens
};

// Returns the UTC Date range that covers "today" in Asia/Taipei (UTC+8)
export function getTaipeiDayBounds() {
  const now = new Date();
  const taipeiDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const [y, m, d] = taipeiDateStr.split('-').map(Number);
  // Midnight Taipei (+08:00) = UTC midnight minus 8 hours
  const startOfDay = new Date(Date.UTC(y, m - 1, d)     - 8 * 3600 * 1000);
  const endOfDay   = new Date(Date.UTC(y, m - 1, d + 1) - 8 * 3600 * 1000);
  return { startOfDay, endOfDay, resetAt: endOfDay };
}
