// Message log backing the year-end Wrapped. Uses Node's built-in SQLite
// (node >= 22.13) so there is nothing to compile.
const path = require('path')
const fs = require('fs')
const { DatabaseSync } = require('node:sqlite')

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'bot.sqlite')
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
const db = new DatabaseSync(DB_PATH)

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    chat_id     INTEGER NOT NULL,
    message_id  INTEGER NOT NULL,
    chat_title  TEXT,
    user_id     INTEGER,
    first_name  TEXT,
    ts          INTEGER NOT NULL,   -- unix seconds
    kind        TEXT NOT NULL,      -- text | photo | gif | sticker | video | voice | document | other
    text        TEXT,
    reply_to_user_id INTEGER,
    PRIMARY KEY (chat_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS messages_chat_ts ON messages (chat_id, ts);

  CREATE TABLE IF NOT EXISTS finals (
    chat_id  INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    ts       INTEGER NOT NULL,
    team     TEXT NOT NULL,
    won      INTEGER NOT NULL,
    summary  TEXT,
    PRIMARY KEY (chat_id, event_id, team)
  );
`)

const insertMsg = db.prepare(`
  INSERT OR IGNORE INTO messages
    (chat_id, message_id, chat_title, user_id, first_name, ts, kind, text, reply_to_user_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const kindOf = (msg) => {
  if (msg.animation) return 'gif'
  if (msg.sticker) return 'sticker'
  if (msg.photo) return 'photo'
  if (msg.video || msg.video_note) return 'video'
  if (msg.voice || msg.audio) return 'voice'
  if (msg.document) return 'document'
  if (msg.text) return 'text'
  return 'other'
}

// Record one Telegram message object. Safe to call from several bots that
// share a group; the primary key dedupes.
const logMessage = (msg) => {
  if (!msg || !msg.chat || msg.from?.is_bot) return
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return
  insertMsg.run(
    msg.chat.id,
    msg.message_id,
    msg.chat.title || null,
    msg.from?.id ?? null,
    msg.from?.first_name ?? null,
    msg.date,
    kindOf(msg),
    msg.text ?? msg.caption ?? null,
    msg.reply_to_message?.from?.id ?? null,
  )
}

const insertFinal = db.prepare(`
  INSERT OR IGNORE INTO finals (chat_id, event_id, ts, team, won, summary) VALUES (?, ?, ?, ?, ?, ?)
`)
const logFinal = (chatId, eventId, team, won, summary) =>
  insertFinal.run(chatId, eventId, Math.floor(Date.now() / 1000), team, won ? 1 : 0, summary)

// Every chat that has at least one logged message in the given year.
const chatsWithMessages = (from, to) =>
  db.prepare(`SELECT chat_id, MAX(chat_title) AS title FROM messages WHERE ts >= ? AND ts < ? GROUP BY chat_id`).all(from, to)

module.exports = { db, logMessage, logFinal, chatsWithMessages }
