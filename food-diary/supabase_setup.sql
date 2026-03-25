-- 吃記 - Supabase 資料庫設定
-- 請到 Supabase 後台 > SQL Editor > 貼上這段 > 點 Run

-- 建立飲食紀錄資料表
CREATE TABLE IF NOT EXISTS entries (
  id          BIGSERIAL PRIMARY KEY,
  user_name   TEXT NOT NULL DEFAULT 'default',
  entry_date  DATE NOT NULL,
  meal        TEXT NOT NULL,
  name        TEXT NOT NULL,
  calories    INTEGER DEFAULT 0,
  portion     TEXT DEFAULT '',
  notes       TEXT DEFAULT '',
  mood        TEXT DEFAULT '😊',
  photos      TEXT[] DEFAULT '{}',
  entry_time  TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 建立索引，讓查詢更快
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_entries_user ON entries(user_name);

-- 開放公開讀寫（不需要登入）
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all" ON entries
  FOR ALL USING (true) WITH CHECK (true);
