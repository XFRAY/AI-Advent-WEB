import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const initialMessages = [
  {
    id: crypto.randomUUID(),
    role: 'agent',
    text: 'Привет! Я первый web-агент Дня 6. Напишите запрос, а я отправлю его в LLM через backend.',
  },
];

function App() {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const canSend = useMemo(() => input.trim().length > 0 && !isLoading, [input, isLoading]);

  async function handleSubmit(event) {
    event.preventDefault();

    const text = input.trim();
    if (!text || isLoading) {
      return;
    }

    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
    };

    setMessages((currentMessages) => [...currentMessages, userMessage]);
    setInput('');
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: text }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Не удалось получить ответ агента.');
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: crypto.randomUUID(),
          role: 'agent',
          text: data.answer,
          metadata: {
            model: data.model,
            usage: data.usage,
            settings: data.settings,
          },
        },
      ]);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Произошла неизвестная ошибка.';

      setError(message);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <main className="app-shell">
      <section className="chat-panel" aria-labelledby="page-title">
        <header className="chat-header">
          <div>
            <p className="eyebrow">AI Advent · День 6</p>
            <h1 id="page-title">Первый web-агент</h1>
          </div>
          <span className="status-pill">LLM API</span>
        </header>

        <div className="messages" aria-live="polite">
          {messages.map((message) => (
            <article className={`message message-${message.role}`} key={message.id}>
              <span className="message-author">
                {message.role === 'user' ? 'Вы' : 'Агент'}
              </span>
              <p>{message.text}</p>
              {message.metadata && <MessageStats metadata={message.metadata} />}
            </article>
          ))}

          {isLoading && (
            <article className="message message-agent">
              <span className="message-author">Агент</span>
              <p className="thinking">Думаю и вызываю LLM...</p>
            </article>
          )}
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <form className="composer" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="message">
            Запрос пользователя
          </label>
          <textarea
            id="message"
            ref={inputRef}
            rows="3"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Например: объясни, что такое агент в LLM-приложении"
            disabled={isLoading}
          />
          <button type="submit" disabled={!canSend}>
            {isLoading ? 'Отправляем...' : 'Отправить'}
          </button>
        </form>
      </section>
    </main>
  );
}

function MessageStats({ metadata }) {
  const { model, settings, usage } = metadata;

  return (
    <dl className="message-stats" aria-label="Статистика запроса">
      <div>
        <dt>Модель</dt>
        <dd>{model || 'неизвестно'}</dd>
      </div>
      <div>
        <dt>Температура</dt>
        <dd>{formatTemperature(settings?.temperature)}</dd>
      </div>
      <div>
        <dt>Input</dt>
        <dd>{formatNumber(usage?.inputTokens)} ток.</dd>
      </div>
      <div>
        <dt>Output</dt>
        <dd>{formatNumber(usage?.outputTokens)} ток.</dd>
      </div>
      <div>
        <dt>Reasoning</dt>
        <dd>{formatNumber(usage?.reasoningTokens)} ток.</dd>
      </div>
      <div>
        <dt>Всего</dt>
        <dd>{formatNumber(usage?.totalTokens)} ток.</dd>
      </div>
      <div>
        <dt>Стоимость</dt>
        <dd>{formatCost(usage?.cost)}</dd>
      </div>
    </dl>
  );
}

function formatNumber(value) {
  if (typeof value !== 'number') {
    return '0';
  }

  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatTemperature(value) {
  return typeof value === 'number' ? value : 'default';
}

function formatCost(cost) {
  if (!cost || typeof cost.estimatedUsd !== 'number') {
    return 'нет данных';
  }

  if (cost.estimatedUsd > 0 && cost.estimatedUsd < 0.0001) {
    return '< $0.0001';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: cost.currency || 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(cost.estimatedUsd);
}

createRoot(document.getElementById('root')).render(<App />);
