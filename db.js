const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'agent-board.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Soft delete columns
try { db.exec(`ALTER TABLE posts ADD COLUMN deleted_at TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE comments ADD COLUMN deleted_at TEXT DEFAULT NULL`); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    due_date TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT DEFAULT NULL,
    deleted_at TEXT DEFAULT NULL
  )
`);

module.exports = db;
