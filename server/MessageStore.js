import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATABASE_PATH = path.join(__dirname, 'data', 'messages.sqlite');

const ALLOWED_ROLES = new Set(['user', 'agent']);
const ALLOWED_MODES = new Set(['full', 'compressed']);

export class MessageStore {
  constructor({ databasePath = DEFAULT_DATABASE_PATH } = {}) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });

    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database
      .prepare(
        `CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          mode TEXT NOT NULL DEFAULT 'full',
          role TEXT NOT NULL CHECK (role IN ('user', 'agent')),
          text TEXT NOT NULL,
          metadata_json TEXT,
          created_at TEXT NOT NULL
        )`,
      )
      .run();
    this.ensureMessagesModeColumn();
    this.database
      .prepare(
        `CREATE TABLE IF NOT EXISTS summaries (
          mode TEXT PRIMARY KEY,
          summary_text TEXT NOT NULL,
          summarized_message_count INTEGER NOT NULL DEFAULT 0,
          last_messages_count INTEGER NOT NULL DEFAULT 0,
          summary_batch_size INTEGER NOT NULL DEFAULT 0,
          metadata_json TEXT,
          updated_at TEXT NOT NULL
        )`,
      )
      .run();
    this.database
      .prepare('CREATE INDEX IF NOT EXISTS idx_messages_mode_created_at ON messages (mode, created_at)')
      .run();

    this.insertMessage = this.database.prepare(
      `INSERT INTO messages (id, mode, role, text, metadata_json, created_at)
       VALUES (@id, @mode, @role, @text, @metadataJson, @createdAt)`,
    );
    this.selectMessages = this.database.prepare(
      `SELECT id, mode, role, text, metadata_json, created_at
       FROM messages
       WHERE mode = @mode
       ORDER BY created_at ASC, rowid ASC`,
    );
    this.deleteMessages = this.database.prepare('DELETE FROM messages');
    this.deleteSummaries = this.database.prepare('DELETE FROM summaries');
    this.selectSummary = this.database.prepare(
      `SELECT mode, summary_text, summarized_message_count, last_messages_count,
              summary_batch_size, metadata_json, updated_at
       FROM summaries
       WHERE mode = @mode`,
    );
    this.upsertSummary = this.database.prepare(
      `INSERT INTO summaries (
          mode, summary_text, summarized_message_count, last_messages_count,
          summary_batch_size, metadata_json, updated_at
        )
       VALUES (
          @mode, @summaryText, @summarizedMessageCount, @lastMessagesCount,
          @summaryBatchSize, @metadataJson, @updatedAt
        )
       ON CONFLICT(mode) DO UPDATE SET
          summary_text = excluded.summary_text,
          summarized_message_count = excluded.summarized_message_count,
          last_messages_count = excluded.last_messages_count,
          summary_batch_size = excluded.summary_batch_size,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`,
    );
  }

  getMessages(mode = 'full') {
    this.assertMode(mode);

    return this.selectMessages.all({ mode }).map((message) => ({
      id: message.id,
      mode: message.mode,
      role: message.role,
      text: message.text,
      metadata: this.parseMetadata(message.metadata_json),
      createdAt: message.created_at,
    }));
  }

  addMessage({ mode = 'full', role, text, metadata = null }) {
    this.assertMode(mode);

    if (!ALLOWED_ROLES.has(role)) {
      throw new Error(`Unsupported message role: ${role}`);
    }

    const message = {
      id: randomUUID(),
      mode,
      role,
      text,
      metadata,
      createdAt: new Date().toISOString(),
    };

    this.insertMessage.run({
      id: message.id,
      mode: message.mode,
      role: message.role,
      text: message.text,
      metadataJson: metadata ? JSON.stringify(metadata) : null,
      createdAt: message.createdAt,
    });

    return message;
  }

  getSummary(mode = 'compressed') {
    this.assertMode(mode);

    const summary = this.selectSummary.get({ mode });

    if (!summary) {
      return null;
    }

    return {
      mode: summary.mode,
      text: summary.summary_text,
      summarizedMessageCount: summary.summarized_message_count,
      lastMessagesCount: summary.last_messages_count,
      summaryBatchSize: summary.summary_batch_size,
      metadata: this.parseMetadata(summary.metadata_json),
      updatedAt: summary.updated_at,
    };
  }

  saveSummary({
    mode = 'compressed',
    text,
    summarizedMessageCount,
    lastMessagesCount,
    summaryBatchSize,
    metadata = null,
  }) {
    this.assertMode(mode);

    const summary = {
      mode,
      text,
      summarizedMessageCount,
      lastMessagesCount,
      summaryBatchSize,
      metadata,
      updatedAt: new Date().toISOString(),
    };

    this.upsertSummary.run({
      mode: summary.mode,
      summaryText: summary.text,
      summarizedMessageCount: summary.summarizedMessageCount,
      lastMessagesCount: summary.lastMessagesCount,
      summaryBatchSize: summary.summaryBatchSize,
      metadataJson: metadata ? JSON.stringify(metadata) : null,
      updatedAt: summary.updatedAt,
    });

    return summary;
  }

  clearMessages() {
    this.deleteMessages.run();
    this.deleteSummaries.run();
  }

  parseMetadata(metadataJson) {
    if (!metadataJson) {
      return null;
    }

    try {
      return JSON.parse(metadataJson);
    } catch {
      return null;
    }
  }

  ensureMessagesModeColumn() {
    const columns = this.database.prepare('PRAGMA table_info(messages)').all();
    const hasModeColumn = columns.some((column) => column.name === 'mode');

    if (!hasModeColumn) {
      this.database.prepare("ALTER TABLE messages ADD COLUMN mode TEXT NOT NULL DEFAULT 'full'").run();
    }
  }

  assertMode(mode) {
    if (!ALLOWED_MODES.has(mode)) {
      throw new Error(`Unsupported message mode: ${mode}`);
    }
  }
}
