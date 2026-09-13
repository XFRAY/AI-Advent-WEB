# День 10: Управление контекстом без summary

Web-приложение сравнивает три стратегии управления контекстом на одном и том же пользовательском вводе:

- `Sliding Window` — хранит только последние N сообщений, старые сообщения удаляются.
- `Sticky Facts` — обновляет отдельный facts-блок key-value и отправляет `facts + последние N сообщений`.
- `Branching` — позволяет сохранить checkpoint, создать ветки `A/B` и продолжать активную ветку независимо.

Один общий ввод отправляет сообщение во все три стратегии. Интерфейс показывает ответы рядом, preview расхода токенов, facts и состояние ветки.

## Запуск

1. Установите зависимости:

```bash
npm install
```

2. Создайте `.env` по примеру `.env.example`:

```bash
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini
PORT=3001
```

3. Запустите frontend и backend:

```bash
npm run dev
```

4. Откройте локальный адрес Vite, обычно `http://localhost:5173`.

## Как работают стратегии

Backend хранит отдельные истории в SQLite:

- `sliding` — после каждого ответа остается только последние N сообщений.
- `facts` — история сохраняется, но в модель уходит только facts-блок и последние N сообщений.
- `branching` — хранит активную ветку. До checkpoint это `main`, после checkpoint доступны `A` и `B`.

Facts обновляются через модель после каждого успешного пользовательского сообщения и используются со следующего запроса. Они имеют фиксированные ключи:

- `goal`
- `constraints`
- `preferences`
- `decisions`
- `openQuestions`
- `agreements`

Branching controls:

1. `Checkpoint` копирует текущую active branch history в ветки `A` и `B`.
2. Переключатели `A/B` меняют активную ветку.
3. Новый общий ввод продолжает только активную branching-ветку, но все равно отправляется также в Sliding и Facts.

## API

- `GET /api/messages` — возвращает `slidingMessages`, `factsMessages`, `branchingMessages`, `facts`, `branchingState`, `strategyStats`.
- `GET /api/config` — возвращает модель, контекстное окно и defaults стратегий.
- `POST /api/context-preview` — считает токены следующего запроса для всех трех стратегий.
- `POST /api/chat/compare` — отправляет один prompt в Sliding, Facts и активную Branching-ветку.
- `POST /api/branching/checkpoint` — создает checkpoint и ветки `A/B`.
- `POST /api/branching/active-branch` — переключает активную ветку.
- `DELETE /api/messages` — очищает все истории, facts и branching state.

## Проверка

```bash
npm test
npm run build
```

Ручной сценарий:

1. Установите `Последние N сообщений`, например `4`.
2. Отправьте 10-15 сообщений с деталями ТЗ.
3. Создайте checkpoint в Branching и переключайтесь между `A/B`.
4. Сравните финальные ответы: Sliding должен быстрее терять ранние детали, Facts должен удерживать договоренности, Branching должен изолировать альтернативные продолжения.
