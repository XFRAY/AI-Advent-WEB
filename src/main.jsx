import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Box, Button, Chip, CircularProgress, CssBaseline, IconButton, Paper, Stack, TextField, ThemeProvider, Typography, createTheme } from '@mui/material';
import './styles.css';

const theme = createTheme({
  palette: { mode: 'dark', primary: { main: '#d7ff64', contrastText: '#10140b' }, secondary: { main: '#8ee8ff' }, background: { default: '#090b08', paper: '#141812' } },
  typography: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', h1: { fontWeight: 800, letterSpacing: '-.055em' }, button: { fontWeight: 750, textTransform: 'none' } },
  shape: { borderRadius: 18 },
});

const examples = [
  { level: '01 · простой', title: 'Короткий факт', prompt: 'Объясни простыми словами, почему небо кажется голубым. Ответь в 3–4 предложениях.' },
  { level: '02 · логика', title: 'Задача в несколько шагов', prompt: 'У фермера есть куры и кролики: всего 20 голов и 56 ног. Сколько кур и сколько кроликов? Покажи ход решения.' },
  { level: '03 · код', title: 'Генерация кода', prompt: 'Напиши классическую функцию debounce(fn, delay) на JavaScript без библиотек: каждый новый вызов должен отменять предыдущий таймер через clearTimeout и запускать новый setTimeout. Добавь короткое объяснение и пример использования.' },
];

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}

function StatusBadge({ status, checking }) {
  const ready = status?.available && status?.modelReady;
  return <Paper className={`status-badge ${ready ? 'ready' : ''}`} variant="outlined">
    <span className="status-dot" />
    <Box><Typography variant="caption" className="status-label">{checking ? 'ПРОВЕРЯЕМ' : ready ? 'МОДЕЛЬ ГОТОВА' : 'НЕТ СОЕДИНЕНИЯ'}</Typography><Typography fontWeight={750}>{status?.model || 'qwen3:1.7b'}</Typography></Box>
  </Paper>;
}

function Message({ item }) {
  const assistant = item.role === 'assistant';
  return <Box className={`message-row ${assistant ? 'assistant' : 'user'}`}>
    <Paper className="message" variant="outlined">
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2} mb={1}>
        <Typography variant="overline" color={assistant ? 'secondary' : 'primary'}>{assistant ? 'QWEN · ЛОКАЛЬНО' : 'ВЫ'}</Typography>
        {assistant && <Typography variant="caption" color="text.secondary">{(item.durationMs / 1000).toFixed(1)} сек.</Typography>}
      </Stack>
      <Typography className="message-content">{item.content}</Typography>
      {assistant && <Stack direction="row" gap={1} mt={2} flexWrap="wrap"><Chip size="small" label="127.0.0.1" /><Chip size="small" label={item.model} />{item.evalCount && <Chip size="small" label={`${item.evalCount} токенов`} />}</Stack>}
    </Paper>
  </Box>;
}

function App() {
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(true);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  const checkStatus = useCallback(async () => {
    setChecking(true); setError('');
    try { setStatus(await request('/api/llm/status')); }
    catch (nextError) { setStatus({ available: false, model: 'qwen3:1.7b', modelReady: false }); setError(nextError.message); }
    finally { setChecking(false); }
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  async function submit(event) {
    event?.preventDefault();
    const content = input.trim();
    if (!content || busy) return;
    const nextMessages = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setInput(''); setBusy(true); setError('');
    try {
      const answer = await request('/api/llm/chat', { method: 'POST', body: JSON.stringify({ messages: nextMessages.map(({ role, content: text }) => ({ role, content: text })) }) });
      setMessages(items => [...items, { role: 'assistant', ...answer }]);
      if (!status?.modelReady) await checkStatus();
    } catch (nextError) { setMessages(messages); setError(nextError.message); setInput(content); }
    finally { setBusy(false); }
  }

  const ready = status?.available && status?.modelReady;
  return <Box className="page-shell">
    <Box component="header" className="topbar">
      <Stack direction="row" alignItems="center" gap={1.2}><Box className="mark">27</Box><Typography fontWeight={850}>AI ADVENT</Typography></Stack>
      <Stack direction="row" gap={1}><Button className="clear-button" onClick={() => { setMessages([]); setInput(''); setError(''); }} disabled={(!messages.length && !input && !error) || busy}>Очистить</Button><IconButton className="refresh-button" onClick={checkStatus} disabled={checking || busy} aria-label="Проверить подключение">↻</IconButton></Stack>
    </Box>

    <Box component="main" className="main-grid">
      <Box className="intro-column">
        <Typography variant="overline" color="primary">ДЕНЬ 27 · CONTEXT MEMORY</Typography>
        <Typography variant="h1">Диалог,<br/><span>который помнит.</span></Typography>
        <Typography className="lead" color="text.secondary">Qwen получает историю текущего разговора и понимает уточнения. Контекст живёт только в этой вкладке и обрабатывается локально.</Typography>
        <StatusBadge status={status} checking={checking} />
        {status?.available && !status.modelReady && <Alert severity="warning">Запустите <code>ollama pull {status.model}</code></Alert>}
        <Box className="local-proof"><span>↳</span><Typography variant="body2"><b>Память без базы данных</b><br/>История вкладки → Express → Ollama :11434</Typography></Box>
      </Box>

      <Paper className="chat-panel" variant="outlined">
        <Box className="chat-head"><Box><Typography variant="overline" color="secondary">SESSION MEMORY · {messages.length} СООБЩ.</Typography><Typography variant="h6" fontWeight={800}>Диалог с Qwen</Typography></Box><Chip label={status?.version ? `Ollama ${status.version}` : 'Ollama'} variant="outlined" /></Box>
        <Box className="chat-scroll">
          {!messages.length && <Box className="empty-state"><Typography variant="h5" fontWeight={800}>Проверьте модель тремя способами</Typography><Typography color="text.secondary">Выберите пример или напишите собственный запрос.</Typography><Box className="example-grid">{examples.map(example => <button key={example.level} className="example-card" onClick={() => setInput(example.prompt)}><span>{example.level}</span><b>{example.title}</b><small>{example.prompt}</small></button>)}</Box></Box>}
          {messages.map((item, index) => <Message key={`${item.role}-${index}`} item={item} />)}
          {busy && <Box className="thinking"><CircularProgress size={18} /><Typography variant="body2">Qwen формирует ответ локально…</Typography></Box>}
          <div ref={bottomRef} />
        </Box>
        <Box className="composer-wrap">
          {error && <Alert className="chat-error" severity="error" action={<Button color="inherit" size="small" onClick={checkStatus}>Проверить</Button>}>{error}</Alert>}
          <Box component="form" className="composer" onSubmit={submit}>
            <TextField multiline minRows={2} maxRows={6} fullWidth placeholder="Спросите локальную модель…" value={input} onChange={event => setInput(event.target.value)} inputProps={{ maxLength: 4000 }} disabled={busy} />
            <Button type="submit" variant="contained" disabled={busy || !input.trim() || !ready}>{busy ? <CircularProgress size={22} /> : 'Отправить →'}</Button>
          </Box>
          <Typography className="privacy-note" variant="caption">Контекст хранится до перезагрузки вкладки · API-ключ не требуется</Typography>
        </Box>
      </Paper>
    </Box>
  </Box>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider></React.StrictMode>);
