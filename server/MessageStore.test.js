import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MessageStore } from './MessageStore.js';

test('MessageStore keeps full messages, compressed messages, and summary separately', () => {
  const databasePath = path.join(
    os.tmpdir(),
    `ai-advent-message-store-${Date.now()}-${Math.random()}.sqlite`,
  );
  const store = new MessageStore({ databasePath });

  store.addMessage({ mode: 'full', role: 'user', text: 'Full history message' });
  store.addMessage({ mode: 'compressed', role: 'user', text: 'Compressed history message' });
  store.saveSummary({
    mode: 'compressed',
    text: 'Compressed summary',
    summarizedMessageCount: 1,
    lastMessagesCount: 6,
    summaryBatchSize: 10,
  });

  assert.deepEqual(
    store.getMessages('full').map((message) => message.text),
    ['Full history message'],
  );
  assert.deepEqual(
    store.getMessages('compressed').map((message) => message.text),
    ['Compressed history message'],
  );
  assert.equal(store.getSummary('compressed').text, 'Compressed summary');
});
