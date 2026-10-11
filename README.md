# День 30 · Приватный LLM-сервис

Локальная `qwen3:1.7b-q4_K_M` работает как приватный сетевой сервис: Ollama изолирован во внутренней Docker-сети, а наружу опубликован только защищённый HTTP API и web-интерфейс. API совместим с форматом OpenAI Chat Completions и принимает полную историю разговора.

```text
браузер / OpenAI SDK ── Bearer API key ──▶ Node API ──▶ очередь ──▶ Ollama
                                                 1 active + 4 queued
```

## Быстрый запуск через Docker Compose

Требуются Docker Engine и Compose plugin на Linux VPS или домашнем сервере.

```sh
cp .env.example .env
openssl rand -hex 32
```

Запишите полученное значение в `API_KEY` файла `.env`, затем запустите сервис:

```sh
docker compose up -d --build
docker compose ps
```

При первом запуске контейнер `model-init` загрузит модель в persistent volume `ollama-data`. Web-интерфейс будет доступен по адресу `http://SERVER_IP:3001`. Порт Ollama `11434` на хост не публикуется.

Для NVIDIA GPU установите NVIDIA Container Toolkit и подключите override:

```sh
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

Откройте `SERVICE_PORT` только для доверенной сети или VPN. Например, с UFW для локальной подсети:

```sh
sudo ufw allow from 192.168.1.0/24 to any port 3001 proto tcp
```

Для публичного домена поставьте перед сервисом Caddy, nginx или Traefik с HTTPS. При работе за reverse proxy задайте `TRUST_PROXY=1`, чтобы rate limit использовал адрес клиента.

## Нативный режим разработки

Нужны Node.js 20.19+ и Ollama:

```sh
ollama serve
ollama pull qwen3:1.7b-q4_K_M
npm install
cp .env.example .env
npm run dev
```

Vite откроется на `http://127.0.0.1:5173`, API — на `http://0.0.0.0:3001`.

## HTTP API

Проверка liveness не требует авторизации и не раскрывает конфигурацию:

```sh
curl http://SERVER_IP:3001/api/health
```

Статус модели, очереди и лимитов защищён ключом:

```sh
curl http://SERVER_IP:3001/api/status \
  -H "Authorization: Bearer $API_KEY"
```

Многотуровый чат использует OpenAI-compatible endpoint:

```sh
curl http://SERVER_IP:3001/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"qwen3:1.7b-q4_K_M",
    "messages":[
      {"role":"system","content":"Отвечай кратко."},
      {"role":"user","content":"Что такое локальная LLM?"}
    ],
    "max_tokens":256,
    "stream":false
  }'
```

Пример с официальным OpenAI SDK:

```js
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.API_KEY, baseURL: 'http://SERVER_IP:3001/v1' });
const response = await client.chat.completions.create({ model: 'qwen3:1.7b-q4_K_M', messages: [{ role: 'user', content: 'Привет!' }] });
console.log(response.choices[0].message.content);
```

Streaming в этой версии не поддерживается. Клиент должен передавать `stream: false` или не указывать поле.

## Ограничения и нагрузка

По умолчанию сервис разрешает 10 авторизованных запросов в минуту для сочетания API-ключа и IP, выполняет одну генерацию и держит до четырёх запросов в FIFO-очереди. Переполнение rate limit или очереди возвращает `429` и `Retry-After`. Контекст ограничен 2048 токенами, ответ — 512 токенами, timeout — 180 секундами. Все значения настраиваются в `.env`.

Экран «Проверка стабильности» отправляет шесть запросов одновременно. При стандартной конфигурации пять выполнятся последовательно, а шестой подтвердит защиту очереди ответом `429`.

## Проверка

```sh
npm test
npm run build
API_KEY=test docker compose config --quiet
```

Тесты используют имитацию Ollama: проверяют авторизацию, контракт Chat Completions, передачу истории, контекст, rate limit, FIFO-очередь, timeout и восстановление после ошибок. Для полного сетевого smoke test запустите Compose и откройте UI с другого устройства в той же сети.
