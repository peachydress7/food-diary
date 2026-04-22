import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { rateLimit } from './_rateLimit.js';
import { AI_CONFIG } from './_aiConfig.js';
import { checkUserQuota, recordUsage } from './_aiQuota.js';

const ALLOWED_ORIGIN = 'https://food-diary-azure.vercel.app';
const MAX_APPROX_BYTES = 5 * 1024 * 1024; // 5 MB (estimated from base64 length)

const SYSTEM_INSTRUCTION = `你是一位專業的營養師助手，專門分析台灣與亞洲常見餐點的照片。你的任務是辨識照片中所有食物項目，並估算每一項的份量與營養素。

辨識原則：
1. 仔細觀察餐盤、便當盒、碗中所有食物，不要遺漏
2. 針對台灣常見食物（便當、自助餐、火鍋、早午餐、夜市小吃）特別熟悉
3. 份量估算以台灣常見份量為基準（一碗白飯約 150-200g、一份便當主菜約 100-150g）
4. 熱量與營養素估算請基於台灣食品營養成分資料庫的常見值
5. 對於看不清楚或不確定的項目，標示 confidence 為 medium 或 low，並在 notes 說明
6. 烹調方式會影響熱量（炸 vs 蒸 vs 炒），請依照外觀判斷
7. 如果照片不是食物、模糊到無法辨識、或空盤，回傳空陣列並在 overall_notes 說明

只回傳 JSON，不要任何其他文字。`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name:       { type: 'STRING' },
          portion:    { type: 'STRING' },
          kcal:       { type: 'NUMBER' },
          protein:    { type: 'NUMBER' },
          carbs:      { type: 'NUMBER' },
          fat:        { type: 'NUMBER' },
          fiber:      { type: 'NUMBER' },
          confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
          notes:      { type: 'STRING' },
        },
        required: ['name', 'portion', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'confidence'],
      },
    },
    total_kcal:           { type: 'NUMBER' },
    overall_notes:        { type: 'STRING' },
    meal_type_suggestion: { type: 'STRING', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
  },
  required: ['items', 'total_kcal'],
};

function quotaPayload(q) {
  return {
    used:      q.unlimited ? null : q.used,
    limit:     q.unlimited ? null : q.limit,
    remaining: q.unlimited ? null : Math.max(0, q.limit - q.used),
    reset_at:  q.resetAt.toISOString(),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key, x-username');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth ──
  if (req.headers['x-app-key'] !== process.env.APP_SECRET) {
    return res.status(401).json({ error: '未授權' });
  }
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(ip)) return res.status(429).json({ error: 'Too many requests' });

  const userId = (req.headers['x-username'] || '').trim();
  if (!userId) return res.status(401).json({ error: '需要登入才能使用 AI 辨識' });

  // ── Quota check ──
  let quota;
  try { quota = await checkUserQuota(userId); }
  catch (e) { return res.status(500).json({ error: '額度查詢失敗，請稍後再試' }); }

  if (!quota.allowed) {
    const hoursLeft = Math.ceil((quota.resetAt - Date.now()) / 3_600_000);
    const why = quota.reason === 'global_limit' ? '今日全站 AI 額度已用完' : `今日 AI 辨識額度已用完（${quota.used}/${quota.limit}）`;
    return res.status(429).json({
      error: 'quota_exceeded',
      message: `${why}，約 ${hoursLeft} 小時後重置，或改用手動輸入`,
      quota: quotaPayload(quota),
    });
  }

  // ── Validate image ──
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: '無效的請求格式' }); }
  }
  const { image } = body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: '請提供圖片' });
  }

  // Strip "data:image/...;base64," prefix
  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
  if (base64Data.length * 0.75 > MAX_APPROX_BYTES) {
    return res.status(400).json({ error: '圖片太大（上限 5MB），請壓縮後再試' });
  }

  if (!AI_CONFIG.geminiApiKey) {
    return res.status(500).json({ error: 'AI 服務未設定，請聯絡管理員' });
  }

  let inputTokens = 0, outputTokens = 0;

  try {
    // ── Compress with sharp ──
    const imgBuffer = Buffer.from(base64Data, 'base64');
    const compressed = await sharp(imgBuffer)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    // ── Call Gemini 2.5 Flash ──
    const genAI = new GoogleGenerativeAI(AI_CONFIG.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const result = await model.generateContent([
      { text: '請分析這張餐點照片，辨識所有食物並估算營養素。' },
      { inlineData: { mimeType: 'image/jpeg', data: compressed.toString('base64') } },
    ]);

    const response = result.response;
    inputTokens  = response.usageMetadata?.promptTokenCount     || 0;
    outputTokens = response.usageMetadata?.candidatesTokenCount || 0;

    let parsed;
    try { parsed = JSON.parse(response.text()); }
    catch { throw new Error('AI 回傳格式異常，請重試'); }

    // Recalculate total if model missed it
    if (!parsed.total_kcal && parsed.items?.length) {
      parsed.total_kcal = parsed.items.reduce((s, i) => s + (i.kcal || 0), 0);
    }

    await recordUsage({ userId, success: true, inputTokens, outputTokens });
    const updatedQuota = await checkUserQuota(userId);

    return res.status(200).json({
      success:              true,
      items:                parsed.items      || [],
      total_kcal:           parsed.total_kcal || 0,
      overall_notes:        parsed.overall_notes        || null,
      meal_type_suggestion: parsed.meal_type_suggestion || null,
      quota: quotaPayload(updatedQuota),
    });

  } catch (e) {
    await recordUsage({ userId, success: false, inputTokens, outputTokens, errorReason: e.message });
    console.error('[analyze-meal]', e);
    return res.status(500).json({ error: '辨識失敗：' + e.message });
  }
}
