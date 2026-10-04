import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export const EMPTY_TASK_STATE = Object.freeze({ goal: null, clarifications: [], constraints: [], terms: [] });

function parseJson(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); }
  catch { return fallback; }
}

function messageFromRow(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    contextFound: row.context_found === null ? null : Boolean(row.context_found),
    sources: parseJson(row.sources_json, []),
    quotes: parseJson(row.quotes_json, []),
    retrieval: parseJson(row.retrieval_json, null),
    settings: parseJson(row.settings_json, null),
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

function conversationFromRow(row, messages) {
  return {
    id: row.id,
    title: row.title,
    taskState: parseJson(row.task_state_json, { ...EMPTY_TASK_STATE }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(messages ? { messages } : {}),
  };
}

export class ChatRepository {
  constructor({ databasePath = process.env.CHAT_DB_PATH || path.resolve('data/chat.sqlite') } = {}) {
    if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        task_state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        context_found INTEGER,
        sources_json TEXT,
        quotes_json TEXT,
        retrieval_json TEXT,
        settings_json TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_conversation_order
      ON messages(conversation_id, created_at);
    `);
    this.insertConversation = this.database.prepare('INSERT INTO conversations (id, title, task_state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    this.selectConversation = this.database.prepare('SELECT * FROM conversations WHERE id = ?');
    this.selectMessages = this.database.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid');
    this.insertMessage = this.database.prepare(`INSERT INTO messages
      (id, conversation_id, role, content, context_found, sources_json, quotes_json, retrieval_json, settings_json, duration_ms, created_at)
      VALUES (@id, @conversationId, @role, @content, @contextFound, @sourcesJson, @quotesJson, @retrievalJson, @settingsJson, @durationMs, @createdAt)`);
    this.updateConversation = this.database.prepare('UPDATE conversations SET title = ?, task_state_json = ?, updated_at = ? WHERE id = ?');
    this.deleteConversations = this.database.prepare('DELETE FROM conversations');
    this.persistTurn = this.database.transaction((conversationId, userContent, assistant, taskState, title) => {
      const now = new Date().toISOString();
      this.insertMessage.run({ id: randomUUID(), conversationId, role: 'user', content: userContent, contextFound: null, sourcesJson: null, quotesJson: null, retrievalJson: null, settingsJson: null, durationMs: null, createdAt: now });
      this.insertMessage.run({
        id: randomUUID(), conversationId, role: 'assistant', content: assistant.answer,
        contextFound: assistant.contextFound ? 1 : 0,
        sourcesJson: JSON.stringify(assistant.sources ?? []), quotesJson: JSON.stringify(assistant.quotes ?? []),
        retrievalJson: JSON.stringify(assistant.retrieval ?? null), settingsJson: JSON.stringify(assistant.settings ?? null),
        durationMs: assistant.durationMs ?? null, createdAt: now,
      });
      this.updateConversation.run(title, JSON.stringify(taskState), now, conversationId);
    });
  }

  createConversation() {
    const now = new Date().toISOString();
    const conversation = { id: randomUUID(), title: 'Новый диалог', taskState: { ...EMPTY_TASK_STATE, clarifications: [], constraints: [], terms: [] }, createdAt: now, updatedAt: now, messages: [] };
    this.insertConversation.run(conversation.id, conversation.title, JSON.stringify(conversation.taskState), now, now);
    return conversation;
  }

  listConversations() {
    return this.database.prepare(`SELECT conversations.*,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id) AS message_count
      FROM conversations ORDER BY updated_at DESC`).all().map(row => ({ ...conversationFromRow(row), messageCount: row.message_count }));
  }

  getConversation(id) {
    const row = this.selectConversation.get(id);
    if (!row) return null;
    return conversationFromRow(row, this.selectMessages.all(id).map(messageFromRow));
  }

  saveTurn(id, { userContent, assistant, taskState, title }) {
    if (!this.selectConversation.get(id)) return null;
    this.persistTurn(id, userContent, assistant, taskState, title);
    return this.getConversation(id);
  }

  clearConversations() {
    return this.deleteConversations.run().changes;
  }

  close() { this.database.close(); }
}
