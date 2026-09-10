# День 6: Первый Web-Агент

Минимальное web-приложение с отдельной сущностью агента. Пользователь пишет запрос в чате, frontend отправляет его на backend, backend передает запрос в `LlmAgent`, а агент вызывает LLM через OpenAI API.

## Запуск

1. Установите зависимости:

```bash
npm install
```

2. Создайте `.env` по примеру `.env.example` и добавьте ключ:

```bash
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5
PORT=3001
```

3. Запустите frontend и backend:

```bash
npm run dev
```

4. Откройте локальный адрес Vite, обычно `http://localhost:5173`.

## Архитектура

- `src/` — React-интерфейс чата.
- `server/index.js` — Express API endpoint `POST /api/chat`.
- `server/LlmAgent.js` — отдельная сущность агента, которая инкапсулирует вызов LLM.

API-ключ используется только на backend и не отправляется в браузер.

После каждого ответа интерфейс показывает служебную статистику: модель, температуру, input/output/reasoning/total tokens и примерную стоимость запроса. Стоимость считается на backend по локальной таблице цен для `gpt-5`, `gpt-5-chat-latest`, `gpt-5-mini` и `gpt-5-nano`; это оценка, а не бухгалтерский чек.
