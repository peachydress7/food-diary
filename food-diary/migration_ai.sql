-- ============================================================
-- 吃記 AI 功能 Migration
-- 到 Supabase Dashboard > SQL Editor > 貼上全部 > Run
-- ============================================================

-- 1. ai_usage 記錄表（每次 AI 呼叫都寫一筆）
CREATE TABLE IF NOT EXISTS ai_usage (
  id            SERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  used_at       TIMESTAMPTZ DEFAULT NOW(),
  success       BOOLEAN NOT NULL DEFAULT TRUE,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      NUMERIC(10, 6),
  model         TEXT DEFAULT 'gemini-2.5-flash',
  error_reason  TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON ai_usage(user_id, used_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_date      ON ai_usage(used_at);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON ai_usage FOR ALL USING (true) WITH CHECK (true);

-- 2. 在 entries 表新增三個欄位
ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS meal_id   TEXT,
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS source    TEXT DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_entries_meal_id ON entries(meal_id);
