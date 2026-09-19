import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInvariantsInput,
  findInvariantConflict,
  getInvariantRules,
  getInvariantStats,
} from './Invariants.js';

const invariants = {
  architecture: 'Монолитная архитектура',
  technicalDecisions: 'REST API между клиентом и сервером',
  stackConstraints: 'Не использовать Python\nИспользовать только React',
  businessRules: 'Платёж нельзя проводить без подтверждения',
};

test('invariants form a separate, ordered system block', () => {
  const input = buildInvariantsInput(invariants);

  assert.equal(input.role, 'system');
  assert.ok(input.content.indexOf('Architecture') < input.content.indexOf('Technical decisions'));
  assert.ok(input.content.indexOf('Technical decisions') < input.content.indexOf('Stack constraints'));
  assert.ok(input.content.indexOf('Stack constraints') < input.content.indexOf('Business rules'));
  assert.match(input.content, /must not propose solutions that violate/);
  assert.equal(getInvariantRules(invariants).length, 5);
  assert.deepEqual(getInvariantStats(invariants), { activeCount: 5, fieldsWithRules: 4 });
});

test('conflict guard detects explicit forbidden technology requests', () => {
  const conflict = findInvariantConflict('Добавь Python для обработки данных', invariants);

  assert.equal(conflict.field, 'stackConstraints');
  assert.equal(conflict.text, 'Не использовать Python');
  assert.equal(findInvariantConflict('Объясни текущую архитектуру', invariants), null);
});

test('conflict guard detects an alternative to a selected architecture', () => {
  const conflict = findInvariantConflict('Перейти на микросервисную архитектуру', invariants);

  assert.equal(conflict.field, 'architecture');
  assert.equal(conflict.text, 'Монолитная архитектура');
});

test('empty invariants do not add a system block', () => {
  assert.equal(buildInvariantsInput({}), null);
  assert.deepEqual(getInvariantStats({}), { activeCount: 0, fieldsWithRules: 0 });
});
