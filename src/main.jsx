import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import { Alert, Box, Button, CircularProgress, CssBaseline, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Stack, TextField, ThemeProvider, Tooltip, Typography, createTheme } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const STAGES = [
  { id: 'planning', label: 'Планирование' },
  { id: 'execution', label: 'Выполнение' },
  { id: 'validation', label: 'Проверка' },
  { id: 'done', label: 'Готово' },
];

const theme = createTheme({
  palette: { background: { default: '#f3f5f1', paper: '#fff' }, primary: { main: '#176b5b' }, secondary: { main: '#b65f33' }, text: { primary: '#17211f', secondary: '#65716d' } },
  shape: { borderRadius: 8 },
  typography: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', h1: { fontSize: '1.35rem', fontWeight: 800, letterSpacing: 0 }, h2: { fontSize: '1rem', fontWeight: 800, letterSpacing: 0 } },
});

function App() {
  const [taskState, setTaskState] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const historyRef = useRef(null);

  useEffect(() => {
    Promise.all([request('/api/task-state'), request('/api/memory')])
      .then(([stateData, memoryData]) => {
        setTaskState(stateData.taskState);
        setMessages(memoryData.shortTermMessages || []);
      })
      .catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(() => {
    if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [messages, busy]);

  async function sendEvent(event) {
    setBusy(true);
    setError('');
    try {
      const data = await request('/api/task-state/event', { method: 'POST', body: JSON.stringify({ event }) });
      setTaskState(data.taskState);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = message.trim();
    if (!text || taskState?.isPaused) return;
    const optimisticId = `pending-${Date.now()}`;
    const optimisticMessage = {
      id: optimisticId,
      role: 'user',
      text,
      metadata: { taskState },
    };

    setBusy(true);
    setError('');
    setMessage('');
    setMessages((current) => [...current, optimisticMessage]);
    try {
      const data = await request('/api/chat', { method: 'POST', body: JSON.stringify({ message: text }) });
      setMessages(data.shortTermMessages || []);
      setTaskState(data.taskState);
    } catch (requestError) {
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setMessage(text);
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearHistory() {
    setBusy(true);
    try {
      const data = await request('/api/memory', { method: 'DELETE' });
      setMessages([]);
      setTaskState(data.taskState);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return <ThemeProvider theme={theme}>
    <CssBaseline />
    <Box component="main" sx={{ height: '100dvh', overflow: 'hidden', p: { xs: 1, md: 2 } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 1, md: 1.5 }, height: '100%', maxWidth: 1180, mx: 'auto', minHeight: 0 }}>
        <Header busy={busy} messageCount={messages.length} onClear={clearHistory} />
        {error && <Alert severity="error">{error}</Alert>}
        <TaskPanel busy={busy} onEvent={sendEvent} taskState={taskState} />
        <Paper component="section" elevation={0} sx={{ border: '1px solid rgba(23,33,31,.13)', display: 'grid', flex: 1, gridTemplateRows: 'minmax(0, 1fr) auto', minHeight: 0, overflow: 'hidden' }}>
          <Stack ref={historyRef} spacing={1.25} sx={{ minHeight: 0, overflowY: 'auto', p: { xs: 1.5, md: 2 } }}>
            {messages.length === 0 && <Stack sx={{ alignItems: 'center', color: 'text.secondary', height: '100%', justifyContent: 'center', textAlign: 'center' }}><Typography fontWeight={800}>Диалог начнётся здесь</Typography><Typography variant="body2">Агент уже знает текущий этап и ожидаемое действие.</Typography></Stack>}
            {messages.map((item) => <Message key={item.id} message={item} />)}
            {busy && messages.length > 0 && <CircularProgress size={20} />}
          </Stack>
          <Box component="form" onSubmit={sendMessage} sx={{ borderTop: '1px solid rgba(23,33,31,.1)', display: 'flex', gap: 1, p: 1.25 }}>
            <TextField disabled={busy || taskState?.isPaused} fullWidth label={taskState?.isPaused ? 'Задача на паузе' : 'Сообщение агенту'} multiline maxRows={5} onChange={(event) => setMessage(event.target.value)} value={message} />
            <Tooltip title={taskState?.isPaused ? 'Сначала продолжите задачу' : 'Отправить'}><span><IconButton aria-label="Отправить" color="primary" disabled={busy || taskState?.isPaused || !message.trim()} type="submit" sx={{ height: 48, width: 48 }}><SendRoundedIcon /></IconButton></span></Tooltip>
          </Box>
        </Paper>
      </Box>
    </Box>
  </ThemeProvider>;
}

function Header({ busy, messageCount, onClear }) {
  return <Paper component="header" elevation={0} sx={{ alignItems: 'center', border: '1px solid rgba(23,33,31,.13)', display: 'flex', justifyContent: 'space-between', p: 1.5 }}>
    <Box><Typography component="h1" variant="h1">AI Advent · День 13</Typography><Typography color="text.secondary" variant="body2">Task State Machine</Typography></Box>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography color="text.secondary" variant="caption">{messageCount} сообщений</Typography><Tooltip title="Очистить диалог"><span><IconButton aria-label="Очистить диалог" color="error" disabled={busy} onClick={onClear}><DeleteSweepRoundedIcon /></IconButton></span></Tooltip></Stack>
  </Paper>;
}

function TaskPanel({ busy, onEvent, taskState }) {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const activeIndex = Math.max(STAGES.findIndex((stage) => stage.id === taskState?.stage), 0);
  return <>
  <Paper component="section" elevation={0} sx={{ border: '1px solid rgba(23,33,31,.13)', px: { xs: 1.25, md: 1.5 }, py: 1 }}>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.75 }}><Typography component="h2" variant="h2">Состояние задачи</Typography>{taskState?.isPaused && <Typography sx={{ bgcolor: '#f7e5d8', color: '#8d431f', px: 1, py: .2, borderRadius: 1 }} variant="caption">На паузе</Typography>}</Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', mb: 0.75 }}>
          {STAGES.map((stage, index) => <Box key={stage.id} sx={{ minWidth: 0, pr: index < 3 ? 1 : 0 }}><Box sx={{ bgcolor: index <= activeIndex ? 'primary.main' : '#dce2df', height: 5, mb: .65 }} /><Typography color={index === activeIndex ? 'primary.main' : 'text.secondary'} fontWeight={index === activeIndex ? 800 : 500} sx={{ overflowWrap: 'anywhere' }} variant="caption">{stage.label}</Typography></Box>)}
        </Box>
        <Box sx={{ display: 'grid', gap: { xs: 0.5, md: 2 }, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' } }}>
          <Box><Typography color="text.secondary" variant="caption">Текущий шаг</Typography><Typography fontWeight={800} variant="body2">{taskState?.currentStep || 'Загрузка...'}</Typography></Box>
          <Box><Typography color="text.secondary" variant="caption">Ожидаемое действие</Typography><Typography variant="body2">{taskState?.expectedAction || 'Загрузка...'}</Typography></Box>
        </Box>
      </Box>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        {taskState?.isPaused ? <Button disabled={busy} onClick={() => onEvent('resume')} startIcon={<PlayArrowRoundedIcon />} variant="contained">Продолжить</Button> : <Button disabled={busy || !taskState} onClick={() => onEvent('pause')} startIcon={<PauseRoundedIcon />} variant="outlined">Пауза</Button>}
        <Button disabled={busy || !taskState || taskState.isPaused || taskState.stage === 'done'} onClick={() => onEvent('advance')} startIcon={<SkipNextRoundedIcon />} variant="contained">Следующий этап</Button>
        {taskState?.stage === 'done' && <Button onClick={() => setSummaryOpen(true)} variant="contained">Итог задачи</Button>}
        <Button color="secondary" disabled={busy} onClick={() => onEvent('reset')} variant="text">Сброс</Button>
      </Stack>
    </Stack>
  </Paper>
  <Dialog fullWidth maxWidth="md" onClose={() => setSummaryOpen(false)} open={summaryOpen}>
    <DialogTitle>Итог задачи</DialogTitle>
    <DialogContent dividers>
      <Typography sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }} variant="body2">
        {taskState?.artifacts?.finalSummary || 'Для этой задачи ещё нет сохранённого итога.'}
      </Typography>
    </DialogContent>
    <DialogActions><Button onClick={() => setSummaryOpen(false)}>Закрыть</Button></DialogActions>
  </Dialog>
  </>;
}

function Message({ message }) {
  const isUser = message.role === 'user';
  const snapshot = message.metadata?.taskState;
  return <Paper elevation={0} sx={{ alignSelf: isUser ? 'flex-end' : 'flex-start', bgcolor: isUser ? '#e5f1ed' : '#f5f0e9', border: '1px solid rgba(23,33,31,.1)', maxWidth: '82%', p: 1.25 }}>
    <Typography color="text.secondary" fontWeight={800} variant="caption">{isUser ? 'Вы' : 'Агент'}</Typography><Typography sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }} variant="body2">{message.text}</Typography>
    {snapshot && <Typography color="text.secondary" sx={{ display: 'block', mt: .75 }} variant="caption">{snapshot.stage} · {snapshot.currentStep}{snapshot.isPaused ? ' · пауза' : ''}</Typography>}
  </Paper>;
}

async function request(url, options = {}) {
  const requestOptions = { headers: { 'Content-Type': 'application/json' }, ...options };
  let response;

  try {
    response = await fetch(url, requestOptions);
  } catch {
    response = null;
  }

  if (!isJsonResponse(response) && url.startsWith('/api/')) {
    try {
      response = await fetch(`http://127.0.0.1:3001${url}`, requestOptions);
    } catch {
      response = null;
    }
  }

  if (!isJsonResponse(response)) {
    throw new Error('API недоступен. Запустите сервер командой npm run dev:server.');
  }

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function isJsonResponse(response) {
  if (!response) return false;

  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json');
}

createRoot(document.getElementById('root')).render(<App />);
