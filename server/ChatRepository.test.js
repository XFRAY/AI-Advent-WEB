import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChatRepository } from './ChatRepository.js';

const assistant = { answer: 'Ответ [S1]', contextFound: true, sources: [{ label: 'S1' }], quotes: [{ sourceLabel: 'S1', quote: 'Цитата' }], retrieval: { rewrittenQuery: 'query' }, settings: { candidateTopK: 8 }, durationMs: 10 };
const state = { goal: 'Выбрать доставку', clarifications: ['Нужен кофе'], constraints: ['До 1000 ₽'], terms: [{ term: 'быстро', meaning: 'за час' }] };

test('repository persists conversations, ordered messages, task state, and isolation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'day25-repository-'));
  const databasePath = path.join(root, 'chat.sqlite');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let repository = new ChatRepository({ databasePath });
  const first = repository.createConversation();
  const second = repository.createConversation();
  repository.saveTurn(first.id, { userContent: 'Вопрос', assistant, taskState: state, title: 'Вопрос' });
  repository.close();
  repository = new ChatRepository({ databasePath });
  t.after(() => repository.close());
  const restored = repository.getConversation(first.id);
  assert.deepEqual(restored.messages.map(message => message.role), ['user', 'assistant']);
  assert.equal(restored.messages[1].sources[0].label, 'S1');
  assert.deepEqual(restored.taskState, state);
  assert.equal(repository.getConversation(second.id).messages.length, 0);
  assert.equal(repository.listConversations().length, 2);
});

test('saveTurn does not write partial data when transaction fails', t => {
  const repository = new ChatRepository({ databasePath: ':memory:' });
  t.after(() => repository.close());
  const conversation = repository.createConversation();
  assert.throws(() => repository.saveTurn(conversation.id, { userContent: 'Вопрос', assistant: { ...assistant, answer: null }, taskState: state, title: 'Вопрос' }));
  assert.equal(repository.getConversation(conversation.id).messages.length, 0);
});

test('clearConversations removes all chats and cascades their messages', t => {
  const repository = new ChatRepository({ databasePath: ':memory:' });
  t.after(() => repository.close());
  const first = repository.createConversation();
  repository.createConversation();
  repository.saveTurn(first.id, { userContent: 'Вопрос', assistant, taskState: state, title: 'Вопрос' });
  assert.equal(repository.clearConversations(), 2);
  assert.deepEqual(repository.listConversations(), []);
  assert.equal(repository.database.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 0);
});
