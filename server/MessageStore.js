import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATABASE_PATH = path.join(__dirname, 'data', 'messages.sqlite');

const ALLOWED_ROLES = new Set(['user', 'agent']);
const ALLOWED_MODES = new Set(['full', 'compressed', 'sliding', 'facts', 'branching']);
const DEFAULT_FACTS = {
  goal: '',
  constraints: '',
  preferences: '',
  decisions: '',
  openQuestions: '',
  agreements: '',
};
const DEFAULT_WORKING_MEMORY = {
  goal: '',
  taskData: '',
  constraints: '',
  openQuestions: '',
  nextSteps: '',
};
const DEFAULT_LONG_TERM_MEMORY = {
  profile: '',
  preferences: '',
  decisions: '',
  knowledge: '',
};
const DEFAULT_USER_PROFILES = [
  {
    id: 'concise-business',
    name: 'Краткий деловой',
    description: 'Для быстрых рабочих решений без лишних отступлений.',
    style: 'Деловой, прямой и спокойный.',
    format: 'Короткий ответ; списки только когда они улучшают сканирование.',
    constraints: 'Не повторять вопрос. Не добавлять вводные фразы и лишние детали.',
    isActive: true,
  },
  {
    id: 'detailed-learning',
    name: 'Подробный учебный',
    description: 'Для изучения темы с объяснением логики и примерами.',
    style: 'Доброжелательный преподаватель, объясняющий термины простым языком.',
    format: 'Структурированный ответ с шагами, пояснениями и коротким примером.',
    constraints: 'Не пропускать важные причинно-следственные связи. Проверять понимание терминов.',
    isActive: false,
  },
];
const DEFAULT_BRANCHING_STATE = {
  activeBranchId: 'main',
  checkpointAt: null,
  checkpointMessageCount: 0,
  checkpointSourceBranchId: null,
  branchLabels: {
    main: 'Main',
    A: 'Branch A',
    B: 'Branch B',
  },
};

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
          branch_id TEXT,
          role TEXT NOT NULL CHECK (role IN ('user', 'agent')),
          text TEXT NOT NULL,
          metadata_json TEXT,
          created_at TEXT NOT NULL
        )`,
      )
      .run();
    this.ensureMessagesModeColumn();
    this.ensureMessagesBranchColumn();
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
      .prepare(
        `CREATE TABLE IF NOT EXISTS facts (
          id TEXT PRIMARY KEY,
          facts_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
      )
      .run();
    this.database
      .prepare(
        `CREATE TABLE IF NOT EXISTS branching_state (
          id TEXT PRIMARY KEY,
          active_branch_id TEXT NOT NULL,
          checkpoint_at TEXT,
          checkpoint_message_count INTEGER NOT NULL DEFAULT 0,
          checkpoint_source_branch_id TEXT,
          branch_labels_json TEXT,
          updated_at TEXT NOT NULL
        )`,
      )
      .run();
    this.database
      .prepare(
        `CREATE TABLE IF NOT EXISTS short_term_messages (
          id TEXT PRIMARY KEY,
          role TEXT NOT NULL CHECK (role IN ('user', 'agent')),
          text TEXT NOT NULL,
          metadata_json TEXT,
          created_at TEXT NOT NULL
        )`,
      )
      .run();
    this.database
      .prepare(
        `CREATE TABLE IF NOT EXISTS working_memory (
          id TEXT PRIMARY KEY,
          memory_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
      )
      .run();
    this.database
      .prepare(
        `CREATE TABLE IF NOT EXISTS long_term_memory (
          id TEXT PRIMARY KEY,
          memory_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
      )
      .run();
    this.database
      .prepare(
        `CREATE TABLE IF NOT EXISTS user_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          style TEXT NOT NULL DEFAULT '',
          format TEXT NOT NULL DEFAULT '',
          constraints TEXT NOT NULL DEFAULT '',
          is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
          updated_at TEXT NOT NULL
        )`,
      )
      .run();
    this.database
      .prepare(
        `CREATE TABLE IF NOT EXISTS profile_comparisons (
          id TEXT PRIMARY KEY,
          question TEXT NOT NULL,
          results_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
      )
      .run();
    this.seedUserProfiles();
    this.database
      .prepare(
        'CREATE INDEX IF NOT EXISTS idx_messages_mode_branch_created_at ON messages (mode, branch_id, created_at)',
      )
      .run();
    this.database
      .prepare(
        'CREATE INDEX IF NOT EXISTS idx_short_term_messages_created_at ON short_term_messages (created_at)',
      )
      .run();

    this.insertMessage = this.database.prepare(
      `INSERT INTO messages (id, mode, branch_id, role, text, metadata_json, created_at)
       VALUES (@id, @mode, @branchId, @role, @text, @metadataJson, @createdAt)`,
    );
    this.insertShortTermMessage = this.database.prepare(
      `INSERT INTO short_term_messages (id, role, text, metadata_json, created_at)
       VALUES (@id, @role, @text, @metadataJson, @createdAt)`,
    );
    this.selectShortTermMessages = this.database.prepare(
      `SELECT id, role, text, metadata_json, created_at
       FROM short_term_messages
       ORDER BY created_at ASC, rowid ASC`,
    );
    this.selectMessages = this.database.prepare(
      `SELECT id, mode, branch_id, role, text, metadata_json, created_at
       FROM messages
       WHERE mode = @mode
         AND ((@branchId IS NULL AND branch_id IS NULL) OR branch_id = @branchId)
       ORDER BY created_at ASC, rowid ASC`,
    );
    this.selectAllModeMessages = this.database.prepare(
      `SELECT id, mode, branch_id, role, text, metadata_json, created_at
       FROM messages
       WHERE mode = @mode
       ORDER BY created_at ASC, rowid ASC`,
    );
    this.deleteMessages = this.database.prepare('DELETE FROM messages');
    this.deleteSummaries = this.database.prepare('DELETE FROM summaries');
    this.deleteFacts = this.database.prepare('DELETE FROM facts');
    this.deleteBranchingState = this.database.prepare('DELETE FROM branching_state');
    this.deleteShortTermMessages = this.database.prepare('DELETE FROM short_term_messages');
    this.deleteWorkingMemory = this.database.prepare('DELETE FROM working_memory');
    this.deleteLongTermMemory = this.database.prepare('DELETE FROM long_term_memory');
    this.deleteMessagesByModeAndBranch = this.database.prepare(
      `DELETE FROM messages
       WHERE mode = @mode
         AND ((@branchId IS NULL AND branch_id IS NULL) OR branch_id = @branchId)`,
    );
    this.deleteOldMessages = this.database.prepare(
      `DELETE FROM messages
       WHERE id IN (
         SELECT id
         FROM messages
         WHERE mode = @mode
           AND ((@branchId IS NULL AND branch_id IS NULL) OR branch_id = @branchId)
         ORDER BY created_at ASC, rowid ASC
         LIMIT @deleteCount
       )`,
    );
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
    this.selectFacts = this.database.prepare('SELECT facts_json, updated_at FROM facts WHERE id = @id');
    this.upsertFacts = this.database.prepare(
      `INSERT INTO facts (id, facts_json, updated_at)
       VALUES (@id, @factsJson, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         facts_json = excluded.facts_json,
         updated_at = excluded.updated_at`,
    );
    this.selectWorkingMemory = this.database.prepare(
      'SELECT memory_json, updated_at FROM working_memory WHERE id = @id',
    );
    this.upsertWorkingMemory = this.database.prepare(
      `INSERT INTO working_memory (id, memory_json, updated_at)
       VALUES (@id, @memoryJson, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         memory_json = excluded.memory_json,
         updated_at = excluded.updated_at`,
    );
    this.selectLongTermMemory = this.database.prepare(
      'SELECT memory_json, updated_at FROM long_term_memory WHERE id = @id',
    );
    this.upsertLongTermMemory = this.database.prepare(
      `INSERT INTO long_term_memory (id, memory_json, updated_at)
       VALUES (@id, @memoryJson, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         memory_json = excluded.memory_json,
         updated_at = excluded.updated_at`,
    );
    this.selectProfiles = this.database.prepare(
      `SELECT id, name, description, style, format, constraints, is_active, updated_at
       FROM user_profiles
       ORDER BY rowid ASC`,
    );
    this.selectProfile = this.database.prepare(
      `SELECT id, name, description, style, format, constraints, is_active, updated_at
       FROM user_profiles
       WHERE id = @id`,
    );
    this.selectActiveProfile = this.database.prepare(
      `SELECT id, name, description, style, format, constraints, is_active, updated_at
       FROM user_profiles
       WHERE is_active = 1
       ORDER BY rowid ASC
       LIMIT 1`,
    );
    this.updateProfile = this.database.prepare(
      `UPDATE user_profiles
       SET name = @name,
           description = @description,
           style = @style,
           format = @format,
           constraints = @constraints,
           updated_at = @updatedAt
       WHERE id = @id`,
    );
    this.deactivateProfiles = this.database.prepare('UPDATE user_profiles SET is_active = 0');
    this.activateProfile = this.database.prepare(
      `UPDATE user_profiles
       SET is_active = 1, updated_at = @updatedAt
       WHERE id = @id`,
    );
    this.selectProfileComparisons = this.database.prepare(
      `SELECT id, question, results_json, created_at
       FROM profile_comparisons
       ORDER BY created_at ASC, rowid ASC`,
    );
    this.insertProfileComparison = this.database.prepare(
      `INSERT INTO profile_comparisons (id, question, results_json, created_at)
       VALUES (@id, @question, @resultsJson, @createdAt)`,
    );
    this.deleteProfileComparisons = this.database.prepare('DELETE FROM profile_comparisons');
    this.selectBranchingState = this.database.prepare(
      `SELECT active_branch_id, checkpoint_at, checkpoint_message_count,
              checkpoint_source_branch_id, branch_labels_json, updated_at
       FROM branching_state
       WHERE id = @id`,
    );
    this.upsertBranchingState = this.database.prepare(
      `INSERT INTO branching_state (
          id, active_branch_id, checkpoint_at, checkpoint_message_count,
          checkpoint_source_branch_id, branch_labels_json, updated_at
        )
       VALUES (
          @id, @activeBranchId, @checkpointAt, @checkpointMessageCount,
          @checkpointSourceBranchId, @branchLabelsJson, @updatedAt
        )
       ON CONFLICT(id) DO UPDATE SET
          active_branch_id = excluded.active_branch_id,
          checkpoint_at = excluded.checkpoint_at,
          checkpoint_message_count = excluded.checkpoint_message_count,
          checkpoint_source_branch_id = excluded.checkpoint_source_branch_id,
          branch_labels_json = excluded.branch_labels_json,
          updated_at = excluded.updated_at`,
    );
  }

  getShortTermMessages() {
    return this.selectShortTermMessages.all().map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      metadata: this.parseMetadata(message.metadata_json),
      createdAt: message.created_at,
    }));
  }

  addShortTermMessage({ role, text, metadata = null }) {
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

    this.insertShortTermMessage.run({
      id: message.id,
      role: message.role,
      text: message.text,
      metadataJson: metadata ? JSON.stringify(metadata) : null,
      createdAt: message.createdAt,
    });

    return message;
  }

  getMessages(mode = 'full', { branchId = null } = {}) {
    this.assertMode(mode);

    return this.selectMessages.all({ mode, branchId }).map((message) => ({
      id: message.id,
      mode: message.mode,
      branchId: message.branch_id,
      role: message.role,
      text: message.text,
      metadata: this.parseMetadata(message.metadata_json),
      createdAt: message.created_at,
    }));
  }

  getAllMessagesForMode(mode = 'full') {
    this.assertMode(mode);

    return this.selectAllModeMessages.all({ mode }).map((message) => ({
      id: message.id,
      mode: message.mode,
      branchId: message.branch_id,
      role: message.role,
      text: message.text,
      metadata: this.parseMetadata(message.metadata_json),
      createdAt: message.created_at,
    }));
  }

  addMessage({ mode = 'full', branchId = null, role, text, metadata = null }) {
    this.assertMode(mode);

    if (!ALLOWED_ROLES.has(role)) {
      throw new Error(`Unsupported message role: ${role}`);
    }

    const message = {
      id: randomUUID(),
      mode,
      branchId,
      role,
      text,
      metadata,
      createdAt: new Date().toISOString(),
    };

    this.insertMessage.run({
      id: message.id,
      mode: message.mode,
      branchId: message.branchId,
      role: message.role,
      text: message.text,
      metadataJson: metadata ? JSON.stringify(metadata) : null,
      createdAt: message.createdAt,
    });

    return message;
  }

  trimMessages({ mode, branchId = null, keepCount }) {
    this.assertMode(mode);

    const count = Math.max(Number(keepCount) || 0, 0);
    const messages = this.getMessages(mode, { branchId });
    const deleteCount = Math.max(messages.length - count, 0);

    if (deleteCount > 0) {
      this.deleteOldMessages.run({ mode, branchId, deleteCount });
    }

    return this.getMessages(mode, { branchId });
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
    this.deleteFacts.run();
    this.deleteBranchingState.run();
    this.clearMemory();
  }

  clearMemory() {
    this.deleteShortTermMessages.run();
    this.deleteWorkingMemory.run();
    this.deleteLongTermMemory.run();
  }

  getWorkingMemory() {
    const row = this.selectWorkingMemory.get({ id: 'default' });

    if (!row) {
      return {
        ...DEFAULT_WORKING_MEMORY,
      };
    }

    return normalizeMemory(row.memory_json, DEFAULT_WORKING_MEMORY);
  }

  saveWorkingMemory(memory) {
    const normalizedMemory = normalizeMemory(memory, DEFAULT_WORKING_MEMORY);

    this.upsertWorkingMemory.run({
      id: 'default',
      memoryJson: JSON.stringify(normalizedMemory),
      updatedAt: new Date().toISOString(),
    });

    return normalizedMemory;
  }

  getLongTermMemory() {
    const row = this.selectLongTermMemory.get({ id: 'default' });

    if (!row) {
      return {
        ...DEFAULT_LONG_TERM_MEMORY,
      };
    }

    return normalizeMemory(row.memory_json, DEFAULT_LONG_TERM_MEMORY);
  }

  saveLongTermMemory(memory) {
    const normalizedMemory = normalizeMemory(memory, DEFAULT_LONG_TERM_MEMORY);

    this.upsertLongTermMemory.run({
      id: 'default',
      memoryJson: JSON.stringify(normalizedMemory),
      updatedAt: new Date().toISOString(),
    });

    return normalizedMemory;
  }

  getProfiles() {
    return this.selectProfiles.all().map(mapProfileRow);
  }

  getActiveProfile() {
    const row = this.selectActiveProfile.get();

    return row ? mapProfileRow(row) : null;
  }

  updateUserProfile(id, updates = {}) {
    const existing = this.selectProfile.get({ id });

    if (!existing) {
      return null;
    }

    const current = mapProfileRow(existing);
    const next = {
      ...current,
      name: normalizeProfileValue(updates.name, current.name),
      description: normalizeProfileValue(updates.description, current.description),
      style: normalizeProfileValue(updates.style, current.style),
      format: normalizeProfileValue(updates.format, current.format),
      constraints: normalizeProfileValue(updates.constraints, current.constraints),
      updatedAt: new Date().toISOString(),
    };

    if (!next.name) {
      throw new Error('Profile name cannot be empty');
    }

    this.updateProfile.run(next);
    return mapProfileRow(this.selectProfile.get({ id }));
  }

  setActiveProfile(id) {
    if (!this.selectProfile.get({ id })) {
      return null;
    }

    const transaction = this.database.transaction(() => {
      this.deactivateProfiles.run();
      this.activateProfile.run({ id, updatedAt: new Date().toISOString() });
    });
    transaction();

    return this.getActiveProfile();
  }

  getProfileComparisons() {
    return this.selectProfileComparisons.all().map((row) => ({
      id: row.id,
      question: row.question,
      results: this.parseMetadata(row.results_json) ?? [],
      createdAt: row.created_at,
    }));
  }

  addProfileComparison({ question, results }) {
    const comparison = {
      id: randomUUID(),
      question,
      results,
      createdAt: new Date().toISOString(),
    };

    this.insertProfileComparison.run({
      id: comparison.id,
      question: comparison.question,
      resultsJson: JSON.stringify(comparison.results),
      createdAt: comparison.createdAt,
    });

    return comparison;
  }

  clearProfileComparisons() {
    this.deleteProfileComparisons.run();
  }

  getFacts() {
    const row = this.selectFacts.get({ id: 'default' });

    if (!row) {
      return {
        ...DEFAULT_FACTS,
      };
    }

    return normalizeFacts(this.parseMetadata(row.facts_json));
  }

  saveFacts(facts) {
    const normalizedFacts = normalizeFacts(facts);

    this.upsertFacts.run({
      id: 'default',
      factsJson: JSON.stringify(normalizedFacts),
      updatedAt: new Date().toISOString(),
    });

    return normalizedFacts;
  }

  getBranchingState() {
    const row = this.selectBranchingState.get({ id: 'default' });

    if (!row) {
      return {
        ...DEFAULT_BRANCHING_STATE,
        branchLabels: {
          ...DEFAULT_BRANCHING_STATE.branchLabels,
        },
      };
    }

    return {
      activeBranchId: row.active_branch_id,
      checkpointAt: row.checkpoint_at,
      checkpointMessageCount: row.checkpoint_message_count,
      checkpointSourceBranchId: row.checkpoint_source_branch_id,
      branchLabels: {
        ...DEFAULT_BRANCHING_STATE.branchLabels,
        ...this.parseMetadata(row.branch_labels_json),
      },
      updatedAt: row.updated_at,
    };
  }

  saveBranchingState(state) {
    const current = this.getBranchingState();
    const next = {
      ...current,
      ...state,
      branchLabels: {
        ...DEFAULT_BRANCHING_STATE.branchLabels,
        ...current.branchLabels,
        ...state.branchLabels,
      },
      updatedAt: new Date().toISOString(),
    };

    this.upsertBranchingState.run({
      id: 'default',
      activeBranchId: next.activeBranchId,
      checkpointAt: next.checkpointAt,
      checkpointMessageCount: next.checkpointMessageCount,
      checkpointSourceBranchId: next.checkpointSourceBranchId,
      branchLabelsJson: JSON.stringify(next.branchLabels),
      updatedAt: next.updatedAt,
    });

    return next;
  }

  setActiveBranch(branchId) {
    const state = this.getBranchingState();
    const allowedBranches = new Set(Object.keys(state.branchLabels));

    if (!allowedBranches.has(branchId)) {
      throw new Error(`Unsupported branch: ${branchId}`);
    }

    return this.saveBranchingState({
      activeBranchId: branchId,
    });
  }

  createBranchingCheckpoint({ sourceBranchId = null } = {}) {
    const sourceMessages = this.getMessages('branching', { branchId: sourceBranchId });
    const checkpointAt = new Date().toISOString();
    const transaction = this.database.transaction(() => {
      for (const branchId of ['A', 'B']) {
        this.deleteMessagesByModeAndBranch.run({ mode: 'branching', branchId });

        for (const message of sourceMessages) {
          this.insertMessage.run({
            id: randomUUID(),
            mode: 'branching',
            branchId,
            role: message.role,
            text: message.text,
            metadataJson: message.metadata ? JSON.stringify(message.metadata) : null,
            createdAt: new Date().toISOString(),
          });
        }
      }
    });

    transaction();

    return this.saveBranchingState({
      activeBranchId: 'A',
      checkpointAt,
      checkpointMessageCount: sourceMessages.length,
      checkpointSourceBranchId: sourceBranchId,
      branchLabels: {
        main: 'Main',
        A: 'Branch A',
        B: 'Branch B',
      },
    });
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

  ensureMessagesBranchColumn() {
    const columns = this.database.prepare('PRAGMA table_info(messages)').all();
    const hasBranchColumn = columns.some((column) => column.name === 'branch_id');

    if (!hasBranchColumn) {
      this.database.prepare('ALTER TABLE messages ADD COLUMN branch_id TEXT').run();
    }
  }

  seedUserProfiles() {
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO user_profiles (
        id, name, description, style, format, constraints, is_active, updated_at
      ) VALUES (
        @id, @name, @description, @style, @format, @constraints, @isActive, @updatedAt
      )`,
    );
    const hasActiveProfile = this.database
      .prepare('SELECT 1 FROM user_profiles WHERE is_active = 1 LIMIT 1')
      .get();
    const transaction = this.database.transaction(() => {
      DEFAULT_USER_PROFILES.forEach((profile, index) => {
        insert.run({
          ...profile,
          isActive: hasActiveProfile ? 0 : Number(index === 0),
          updatedAt: new Date().toISOString(),
        });
      });
    });

    transaction();
  }

  assertMode(mode) {
    if (!ALLOWED_MODES.has(mode)) {
      throw new Error(`Unsupported message mode: ${mode}`);
    }
  }
}

function normalizeFacts(facts) {
  return Object.fromEntries(
    Object.entries(DEFAULT_FACTS).map(([key, fallback]) => {
      const value = facts?.[key];

      if (Array.isArray(value)) {
        return [key, value.join('; ')];
      }

      if (typeof value === 'string') {
        return [key, value];
      }

      if (value == null) {
        return [key, fallback];
      }

      return [key, String(value)];
    }),
  );
}

export { DEFAULT_FACTS, DEFAULT_BRANCHING_STATE };

function normalizeMemory(memoryOrJson, defaults) {
  const memory =
    typeof memoryOrJson === 'string' ? parseMemoryJson(memoryOrJson) : memoryOrJson;

  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => {
      const value = memory?.[key];

      return [key, formatMemoryValue(value, fallback)];
    }),
  );
}

function formatMemoryValue(value, fallback = '') {
  if (Array.isArray(value)) {
    return value.map((item) => formatMemoryValue(item)).filter(Boolean).join('; ');
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value == null) {
    return fallback;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, nestedValue]) => nestedValue != null && nestedValue !== '')
      .map(([nestedKey, nestedValue]) => `${nestedKey}: ${formatMemoryValue(nestedValue)}`);

    return entries.length > 0 ? entries.join('; ') : fallback;
  }

  return String(value);
}

function parseMemoryJson(memoryJson) {
  try {
    return JSON.parse(memoryJson);
  } catch {
    return null;
  }
}

export { DEFAULT_WORKING_MEMORY, DEFAULT_LONG_TERM_MEMORY };

function mapProfileRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    style: row.style,
    format: row.format,
    constraints: row.constraints,
    isActive: Boolean(row.is_active),
    updatedAt: row.updated_at,
  };
}

function normalizeProfileValue(value, fallback = '') {
  if (value === undefined) {
    return fallback;
  }

  return formatMemoryValue(value).trim();
}

export { DEFAULT_USER_PROFILES };
