import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChatAgent, TASK_STATE_FORMAT, validateTaskState } from './ChatAgent.js';
import { ChatRepository } from './ChatRepository.js';
import { buildIndex } from './indexing/pipeline.js';

const embedder = { model: 'chat-test', async embed(texts) { return texts.map(text => [text.length || 1, 1]); } };

async function fixture(t, generator) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'day25-agent-'));
  await fs.writeFile(path.join(root, 'guide.md'), '# Доставка\nБесплатная доставка действует от 1000 рублей.\n# Кофе\nАрабика подходит для фильтра.');
  const manifestPath = path.join(root, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify({ entries: [{ path: 'guide.md', source: 'handbook' }] }));
  const indexesDir = path.join(root, 'indexes');
  await buildIndex({ embedder, indexesDir, manifestPath });
  const repository = new ChatRepository({ databasePath: path.join(root, 'chat.sqlite') });
  t.after(() => { repository.close(); return fs.rm(root, { recursive: true, force: true }); });
  return { repository, agent: new ChatAgent({ repository, embedder, generator, indexesDir }) };
}

function scenarioGenerator() {
  return { async generate(call) {
    if (call.format?.name === TASK_STATE_FORMAT.name) {
      const previous = JSON.parse(call.input.match(/Текущая память:\n([^\n]+)/)[1]);
      const message = call.input.split('Новое сообщение пользователя:\n').at(-1);
      const next = structuredClone(previous);
      if (message.includes('цель:')) next.goal = message.split('цель:')[1].trim();
      if (message.includes('ограничение:')) next.constraints = [...new Set([...next.constraints, message.split('ограничение:')[1].trim()])];
      if (message.includes('уточнение:')) next.clarifications = [...new Set([...next.clarifications, message.split('уточнение:')[1].trim()])];
      if (message.includes('термин:')) {
        const [term, meaning] = message.split('термин:')[1].trim().split('=');
        next.terms = [...next.terms.filter(item => item.term !== term), { term, meaning }];
      }
      return JSON.stringify(next);
    }
    if (!call.format) return `поиск ${call.input.split('Последнее сообщение:\n').at(-1)}`;
    const quote = call.input.match(/<source>\n([^\n]+)/)?.[1];
    return JSON.stringify({ answer: 'Подтверждённый ответ [S1]', citations: [{ sourceLabel: 'S1', quote }] });
  } };
}

test('task state validation normalizes values and rejects invalid output', () => {
  assert.deepEqual(validateTaskState({ goal: ' Цель ', clarifications: ['Факт', 'факт'], constraints: [], terms: [{ term: 'MVP', meaning: ' версия ' }] }), { goal: 'Цель', clarifications: ['факт'], constraints: [], terms: [{ term: 'MVP', meaning: 'версия' }] });
  assert.throws(() => validateTaskState({ goal: 'x', clarifications: [], constraints: [], terms: [{ term: '', meaning: 'x' }] }), /термин|term/i);
  assert.throws(() => validateTaskState('{bad json'), /JSON/);
});

test('history and task state participate in rewrite and grounded answer', async t => {
  const calls = [];
  const generator = scenarioGenerator();
  const wrapped = { async generate(call) { calls.push(call); return generator.generate(call); } };
  const { repository, agent } = await fixture(t, wrapped);
  const conversation = repository.createConversation();
  await agent.answer(conversation.id, 'цель: подобрать доставку', { similarityThreshold: -1 });
  await agent.answer(conversation.id, 'А что насчёт неё?', { similarityThreshold: -1 });
  const rewrite = calls.filter(call => !call.format).at(-1).input;
  const grounded = calls.filter(call => call.format?.name === 'grounded_rag_answer').at(-1).input;
  assert.match(rewrite, /подобрать доставку/);
  assert.match(rewrite, /А что насчёт неё/);
  assert.match(grounded, /Память задачи/);
  assert.equal(repository.getConversation(conversation.id).messages.length, 4);
});

test('failed generation leaves conversation and task state unchanged', async t => {
  const generator = { async generate(call) { return call.format?.name === 'task_state' ? '{bad' : 'unused'; } };
  const { repository, agent } = await fixture(t, generator);
  const conversation = repository.createConversation();
  await assert.rejects(agent.answer(conversation.id, 'Вопрос', { similarityThreshold: -1 }), /JSON/);
  assert.deepEqual(repository.getConversation(conversation.id), conversation);
});

test('weak chat context is persisted as an explicit answer without sources', async t => {
  let groundedCalls = 0;
  const base = scenarioGenerator();
  const generator = { async generate(call) { if (call.format?.name === 'grounded_rag_answer') groundedCalls += 1; return base.generate(call); } };
  const { repository, agent } = await fixture(t, generator);
  const conversation = repository.createConversation();
  const result = await agent.answer(conversation.id, 'цель: найти неизвестный факт', { similarityThreshold: 1 });
  assert.equal(result.message.contextFound, false);
  assert.deepEqual(result.message.sources, []);
  assert.match(result.message.content, /Я не знаю/);
  assert.equal(groundedCalls, 0);
  assert.equal(repository.getConversation(conversation.id).messages.length, 2);
});

for (const scenario of [
  { name: 'goal and constraints survive a 12-message scenario', messages: ['цель: выбрать кофе для офиса', 'уточнение: в офисе 20 человек', 'ограничение: только арабика', 'Какой вариант?', 'А доставка?', 'Что известно?', 'Продолжай', 'А для фильтра?', 'Напомни условия', 'Что с ценой?', 'Итог?', 'Сохрани цель'] },
  { name: 'terms and revised details survive a 10-message scenario', messages: ['цель: организовать доставку кофе', 'термин: быстро=за два часа', 'ограничение: бюджет до 1000 рублей', 'Что подходит?', 'уточнение: нужен фильтр', 'А этот вариант?', 'термин: быстро=за один час', 'Что по доставке?', 'Не потерял цель?', 'Подведи итог'] },
]) test(scenario.name, async t => {
  const { repository, agent } = await fixture(t, scenarioGenerator());
  const conversation = repository.createConversation();
  for (const message of scenario.messages) {
    const result = await agent.answer(conversation.id, message, { similarityThreshold: -1 });
    assert.ok(result.message.contextFound ? result.message.sources.length > 0 : result.message.sources.length === 0);
  }
  const saved = repository.getConversation(conversation.id);
  assert.equal(saved.messages.length, scenario.messages.length * 2);
  assert.ok(saved.taskState.goal);
  if (scenario.messages.some(item => item.includes('ограничение:'))) assert.ok(saved.taskState.constraints.length);
  if (scenario.messages.some(item => item.includes('термин:'))) assert.equal(saved.taskState.terms.find(item => item.term === 'быстро').meaning, 'за один час');
  for (const message of saved.messages.filter(item => item.role === 'assistant')) assert.ok(message.contextFound ? message.sources.length : message.sources.length === 0);
});
