import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATABASE_PATH = path.join(__dirname, 'data', 'messages.sqlite');

const ALLOWED_ROLES = new Set(['user', 'agent']);

export class MessageStore {
  constructor({ databasePath = DEFAULT_DATABASE_PATH } = {}) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });

    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database
      .prepare(
        `CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          role TEXT NOT NULL CHECK (role IN ('user', 'agent')),
          text TEXT NOT NULL,
          metadata_json TEXT,
          created_at TEXT NOT NULL
        )`,
      )
      .run();

    this.insertMessage = this.database.prepare(
      `INSERT INTO messages (id, role, text, metadata_json, created_at)
       VALUES (@id, @role, @text, @metadataJson, @createdAt)`,
    );
    this.selectMessages = this.database.prepare(
      `SELECT id, role, text, metadata_json, created_at
       FROM messages
       ORDER BY created_at ASC, rowid ASC`,
    );
    this.deleteMessages = this.database.prepare('DELETE FROM messages');
  }

  getMessages() {
    return this.selectMessages.all().map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      metadata: this.parseMetadata(message.metadata_json),
      createdAt: message.created_at,
    }));
  }

  addMessage({ role, text, metadata = null }) {
    if (!ALLOWED_ROLES.has(role)) {
      throw new Error(`Unsupported message role: ${role}`);
    }

    const message = {
      id: randomUUID(),
      role,
      text,
      metadata,
      createdAt: new Date().toISOString(),
    };

    this.insertMessage.run({
      id: message.id,
      role: message.role,
      text: message.text,
      metadataJson: metadata ? JSON.stringify(metadata) : null,
      createdAt: message.createdAt,
    });

    return message;
  }

  clearMessages() {
    this.deleteMessages.run();
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
}
