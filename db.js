const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'attendee.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('worker','hr')),
  department    TEXT NOT NULL,
  job_title     TEXT NOT NULL,
  location      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,                       -- YYYY-MM-DD
  status     TEXT NOT NULL CHECK (status IN ('Present','Absent','On Leave','Late')),
  marked_by  INTEGER NOT NULL REFERENCES users(id),
  marked_at  TEXT NOT NULL DEFAULT (datetime('now')),
  check_in   TEXT,                                -- HH:MM (24h)
  check_out  TEXT,                                -- HH:MM (24h)
  late_minutes INTEGER NOT NULL DEFAULT 0,        -- minutes after the start time
  UNIQUE (user_id, date)                          -- one record per person per day
);
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(date);
`);

// Upgrade older databases that were created before check-in/out times existed
const have = db.prepare('PRAGMA table_info(attendance)').all().map(c => c.name);
for (const [name, type] of [['check_in', 'TEXT'], ['check_out', 'TEXT'], ['late_minutes', 'INTEGER NOT NULL DEFAULT 0']])
  if (!have.includes(name)) db.exec(`ALTER TABLE attendance ADD COLUMN ${name} ${type}`);

module.exports = db;
