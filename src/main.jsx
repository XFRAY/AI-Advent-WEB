import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Box, Button, Chip, CircularProgress, CssBaseline, IconButton, InputAdornment, LinearProgress, Paper, Stack, TextField, ThemeProvider, Tooltip, Typography, createTheme } from '@mui/material';
import './styles.css';

const glyph = value => function Glyph() { return <span className="glyph" aria-hidden="true">{value}</span>; };
const DeleteOutline = glyph('⌫'); const Key = glyph('◆'); const Lan = glyph('⌁'); const Lock = glyph('▣'); const PlayArrow = glyph('▶'); const Refresh = glyph('↻'); const Send = glyph('➜'); const Speed = glyph('ϟ'); const Visibility = glyph('◉'); const VisibilityOff = glyph('○');

const theme = createTheme({ palette: { mode: 'dark', primary: { main: '#d7ff53', contrastText: '#101409' }, secondary: { main: '#6bdcff' }, background: { default: '#080a08', paper: '#141712' } }, typography: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', h1: { fontWeight: 900, letterSpacing: '-.055em' }, h4: { fontWeight: 850 }, button: { fontWeight: 800, textTransform: 'none' } }, shape: { borderRadius: 16 } });
const examples = ['Объясни StateFlow на простом примере', 'Напиши retry с exponential backoff на Kotlin', 'Как безопасно хранить токен в Android?'];

async function api(path, key, options = {}) {
  const started = performance.now();
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${key}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error?.message || 'Сервис не ответил.'); error.status = response.status; error.code = data.error?.code; error.retryAfter = response.headers.get('Retry-After'); throw error; }
  return { data, elapsed: Math.round(performance.now() - started), remaining: response.headers.get('X-RateLimit-Remaining') };
}

function StatusDot({ ok, children }) { return <Chip size="small" className={ok ? 'status-ok' : ''} variant="outlined" label={<><span className="dot"/>{children}</>} />; }
function Metric({ label, value, accent }) { return <Box className="metric"><Typography variant="caption">{label}</Typography><Typography className={accent ? 'accent' : ''}>{value}</Typography></Box>; }

function App() {
  const [key, setKey] = useState(() => sessionStorage.getItem('day30-api-key') || '');
  const [showKey, setShowKey] = useState(false); const [status, setStatus] = useState(null); const [statusError, setStatusError] = useState('');
  const [messages, setMessages] = useState([]); const [input, setInput] = useState(examples[0]); const [busy, setBusy] = useState(false); const [chatError, setChatError] = useState('');
  const [loadResults, setLoadResults] = useState([]); const [loadBusy, setLoadBusy] = useState(false); const endRef = useRef(null);

  const refreshStatus = useCallback(async () => {
    if (!key.trim()) { setStatus(null); setStatusError(''); return; }
    try { const result = await api('/api/status', key.trim()); setStatus(result.data); setStatusError(''); }
    catch (error) { setStatus(null); setStatusError(error.status === 401 ? 'Ключ не принят сервисом.' : error.message); }
  }, [key]);
  useEffect(() => { const id = setTimeout(refreshStatus, 250); return () => clearTimeout(id); }, [refreshStatus]);
  useEffect(() => { if (key) sessionStorage.setItem('day30-api-key', key); else sessionStorage.removeItem('day30-api-key'); }, [key]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  async function send(event) {
    event.preventDefault(); const text = input.trim(); if (!text || busy || !status) return;
    const next = [...messages, { role: 'user', content: text }]; setMessages(next); setInput(''); setBusy(true); setChatError('');
    try { const result = await api('/v1/chat/completions', key.trim(), { method: 'POST', body: JSON.stringify({ model: status.model, messages: next, temperature: 0.3, max_tokens: Math.min(320, status.limits.maxOutputTokens), stream: false }) }); setMessages(current => [...current, result.data.choices[0].message]); }
    catch (error) { setChatError(error.status === 429 ? `${error.message}${error.retryAfter ? ` Повторите через ${error.retryAfter} с.` : ''}` : error.message); setInput(text); setMessages(messages); }
    finally { setBusy(false); refreshStatus(); }
  }

  async function runLoadTest() {
    if (!status || loadBusy) return; setLoadBusy(true); setLoadResults([]);
    const jobs = Array.from({ length: 6 }, (_, index) => (async () => {
      const started = performance.now();
      try { const result = await api('/v1/chat/completions', key.trim(), { method: 'POST', body: JSON.stringify({ model: status.model, messages: [{ role: 'user', content: `Проверка сети #${index + 1}. Ответь одним словом: готов.` }], max_tokens: 16, temperature: 0, stream: false }) }); return { id: index + 1, ok: true, code: 200, elapsed: result.elapsed, answer: result.data.choices[0].message.content }; }
      catch (error) { return { id: index + 1, ok: false, code: error.status || 'ERR', elapsed: Math.round(performance.now() - started), answer: error.code === 'queue_full' ? 'очередь заполнена' : error.message }; }
    })());
    const results = await Promise.all(jobs); setLoadResults(results); setLoadBusy(false); refreshStatus();
  }

  const ready = status?.ollama.available && status?.ollama.installed;
  return <Box className="page-shell">
    <Box component="header" className="topbar"><Stack direction="row" alignItems="center" gap={1.2}><Box className="mark">30</Box><Typography fontWeight={900}>AI ADVENT</Typography><Chip size="small" label="PRIVATE NODE" className="private-chip" /></Stack><Stack direction="row" gap={1} alignItems="center"><StatusDot ok={ready}>{ready ? 'service online' : 'locked / offline'}</StatusDot><Tooltip title="Обновить статус"><IconButton onClick={refreshStatus}><Refresh /></IconButton></Tooltip></Stack></Box>
    <Box component="main" className="service-layout">
      <Box className="left-column">
        <Box className="hero"><Typography variant="overline" color="primary">ДЕНЬ 30 · PRIVATE LLM SERVICE</Typography><Typography variant="h1">Ваш AI.<br/><span>В вашей сети.</span></Typography><Typography className="lead" color="text.secondary">Локальная Qwen отвечает через защищённый OpenAI-compatible API. История остаётся в браузере, модель — на вашем сервере.</Typography></Box>
        <Paper className="access-card" variant="outlined"><Stack direction="row" gap={1.2} alignItems="center"><Box className="icon-box"><Key /></Box><Box><Typography fontWeight={850}>Доступ к узлу</Typography><Typography variant="caption" color="text.secondary">Ключ хранится только в этой вкладке</Typography></Box></Stack><TextField type={showKey ? 'text' : 'password'} size="small" fullWidth value={key} onChange={event => setKey(event.target.value)} placeholder="Bearer API key" InputProps={{ endAdornment: <InputAdornment position="end"><IconButton size="small" onClick={() => setShowKey(value => !value)}>{showKey ? <VisibilityOff/> : <Visibility/>}</IconButton></InputAdornment> }}/>{statusError && <Alert severity="error">{statusError}</Alert>}</Paper>
        <Paper className="node-card" variant="outlined"><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="overline" color="secondary">NODE STATUS</Typography><Typography className="model-name">{status?.model || 'qwen3:1.7b-q4_K_M'}</Typography></Box><Box className="lock-badge"><Lock /></Box></Stack><Box className="metric-grid"><Metric label="CONTEXT" value={status ? `${status.limits.contextTokens} tok` : '—'}/><Metric label="MAX OUTPUT" value={status ? `${status.limits.maxOutputTokens} tok` : '—'}/><Metric label="RATE LIMIT" value={status ? `${status.limits.requestsPerWindow}/min` : '—'}/><Metric label="QUEUE" value={status ? `${status.runtime.queued}/${status.limits.queueSize}` : '—'} accent={status?.runtime.queued > 0}/></Box></Paper>
      </Box>
      <Paper className="workspace" variant="outlined">
        <Box className="workspace-tabs"><Button className="active-tab" startIcon={<Lan/>}>Сетевой чат</Button><Box className="secure-label"><Lock fontSize="inherit"/> HTTP API · Bearer</Box>{messages.length > 0 && <Button color="inherit" size="small" startIcon={<DeleteOutline/>} onClick={() => { setMessages([]); setChatError(''); }}>Очистить</Button>}</Box>
        <Box className="conversation">
          {!ready && <Box className="empty-state"><Box className="big-lock"><Lock/></Box><Typography variant="h4">Подключите приватный узел</Typography><Typography color="text.secondary">Введите API-ключ. Сервис проверит Ollama и наличие модели.</Typography></Box>}
          {ready && messages.length === 0 && <Box className="empty-state"><Typography variant="overline" color="primary">CONNECTION ESTABLISHED</Typography><Typography variant="h4">Канал защищён ключом</Typography><Typography color="text.secondary">Начните диалог — вся история будет передаваться вашей локальной модели.</Typography><Stack direction="row" gap={1} flexWrap="wrap" justifyContent="center">{examples.map(example => <Button key={example} variant="outlined" size="small" onClick={() => setInput(example)}>{example}</Button>)}</Stack></Box>}
          {ready && messages.length > 0 && <Box className="messages">{messages.map((message, index) => <Box key={`${message.role}-${index}`} className={`message-row ${message.role}`}><Paper className="message-bubble" variant="outlined"><Typography variant="overline">{message.role === 'user' ? 'YOU' : 'LOCAL QWEN'}</Typography><Typography>{message.content}</Typography></Paper></Box>)}{busy && <Box className="message-row assistant"><Paper className="message-bubble thinking" variant="outlined"><LinearProgress/><Typography variant="body2">Модель генерирует ответ…</Typography></Paper></Box>}<div ref={endRef}/></Box>}
        </Box>
        {chatError && <Alert severity="error" className="chat-error">{chatError}</Alert>}
        <Box component="form" className="composer" onSubmit={send}><TextField fullWidth multiline minRows={2} maxRows={5} value={input} onChange={event => setInput(event.target.value)} placeholder="Сообщение локальной модели…" disabled={!ready || busy}/><Button type="submit" variant="contained" disabled={!ready || busy || !input.trim()}>{busy ? <CircularProgress size={22}/> : <Send/>}</Button></Box>
        <Box className="load-panel"><Box className="load-copy"><Box className="speed-icon"><Speed/></Box><Box><Typography fontWeight={850}>Проверка стабильности</Typography><Typography variant="caption" color="text.secondary">6 одновременных запросов · очередь до {status?.limits.queueSize ?? 4}</Typography></Box></Box><Button variant="outlined" startIcon={loadBusy ? <CircularProgress size={16}/> : <PlayArrow/>} disabled={!ready || loadBusy} onClick={runLoadTest}>{loadBusy ? 'Проверяем' : 'Запустить'}</Button>{(loadBusy || loadResults.length > 0) && <Box className="load-results">{loadBusy && <LinearProgress/>}{loadResults.map(item => <Box key={item.id} className={`load-row ${item.ok ? 'success' : 'failure'}`}><b>#{item.id}</b><Chip size="small" label={item.code}/><span>{item.elapsed} ms</span><em>{item.answer}</em></Box>)}</Box>}</Box>
      </Paper>
    </Box>
  </Box>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline/><App/></ThemeProvider></React.StrictMode>);
