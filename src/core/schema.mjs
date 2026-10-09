// Schema SQLite. Để dạng module (không phải .sql rời) vì file .sql không được
// bundle vào out/main/, mà app đóng gói thì không có cây thư mục nguồn.
export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS words (
  id           INTEGER PRIMARY KEY,
  hanzi        TEXT NOT NULL UNIQUE,
  pinyin       TEXT NOT NULL,
  hanviet      TEXT NOT NULL DEFAULT '',
  meaning_vi   TEXT NOT NULL DEFAULT '',
  meaning_vi_alt TEXT NOT NULL DEFAULT '',
  pos_vi       TEXT NOT NULL DEFAULT '',
  hsk_level    INTEGER NOT NULL,
  standard     TEXT NOT NULL DEFAULT 'hsk3',
  stages       TEXT NOT NULL DEFAULT '["production"]',
  anchor       TEXT NOT NULL DEFAULT 'production',
  lesson       TEXT NOT NULL DEFAULT '',
  radical      TEXT NOT NULL DEFAULT '',
  example_zh   TEXT NOT NULL DEFAULT '',
  example_pinyin TEXT NOT NULL DEFAULT '',
  example_vi   TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  homophone_key TEXT NOT NULL DEFAULT '',
  frequency    INTEGER,
  active       INTEGER NOT NULL DEFAULT 1,
  -- Cách ly: từ bị nghi sai dữ liệu, ngừng dạy NGAY tới khi xử lý xong.
  quarantined  INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_words_homophone ON words(homophone_key);
CREATE INDEX IF NOT EXISTS idx_words_level ON words(hsk_level);

CREATE TABLE IF NOT EXISTS cards (
  id          INTEGER PRIMARY KEY,
  word_id     INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  direction   TEXT NOT NULL,              -- production | reading | cloze | handwriting
  stability   REAL    NOT NULL DEFAULT 0,
  difficulty  REAL    NOT NULL DEFAULT 0,
  due         TEXT    NOT NULL,           -- ISO date
  reps        INTEGER NOT NULL DEFAULT 0,
  lapses      INTEGER NOT NULL DEFAULT 0,
  state       INTEGER NOT NULL DEFAULT 0, -- FSRS State
  last_review TEXT,
  UNIQUE(word_id, direction)
);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due, direction);

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY,
  date         TEXT NOT NULL UNIQUE,      -- YYYY-MM-DD giờ địa phương
  target_count INTEGER NOT NULL,
  passed_count INTEGER NOT NULL DEFAULT 0,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at  TEXT,
  snoozes_used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_queue (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  word_id    INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  reason     TEXT NOT NULL,               -- due | new | leech | homophone_sibling | replacement
  passed_at  TEXT,
  PRIMARY KEY (session_id, word_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY,
  card_id    INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  ts         TEXT NOT NULL DEFAULT (datetime('now')),
  grade      INTEGER NOT NULL,            -- 1 Again .. 4 Easy
  latency_ms INTEGER NOT NULL DEFAULT 0,
  answer_raw TEXT NOT NULL DEFAULT '',
  -- none | homophone_wrong_char | wrong_char | blank | timeout | meaning_wrong
  error_type TEXT NOT NULL DEFAULT 'none'
);
CREATE INDEX IF NOT EXISTS idx_reviews_err ON reviews(error_type, ts);

CREATE TABLE IF NOT EXISTS reports (
  id              INTEGER PRIMARY KEY,
  report_id       TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  word_id         INTEGER REFERENCES words(id) ON DELETE SET NULL,
  hanzi           TEXT NOT NULL,
  field           TEXT NOT NULL,          -- hanzi|pinyin|meaning_vi|example|grading|other
  app_value       TEXT NOT NULL DEFAULT '',
  my_correction   TEXT NOT NULL DEFAULT '',
  reason          TEXT NOT NULL DEFAULT '',
  session_id      INTEGER,
  status          TEXT NOT NULL DEFAULT 'new',
  synced_at       TEXT,
  resolved_at     TEXT,
  resolution_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
