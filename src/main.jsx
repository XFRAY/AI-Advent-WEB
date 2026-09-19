import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import { Alert, Box, Button, CircularProgress, CssBaseline, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Stack, TextField, ThemeProvider, Tooltip, Typography, createTheme } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const EMPTY_INVARIANTS = { architecture: '', technicalDecisions: '', stackConstraints: '', businessRules: '' };

const theme = createTheme({
  palette: { background: { default: '#f3f5f1', paper: '#fff' }, primary: { main: '#176b5b' }, secondary: { main: '#b65f33' }, text: { primary: '#17211f', secondary: '#65716d' } },
  shape: { borderRadius: 8 },
  typography: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', h1: { fontSize: '1.35rem', fontWeight: 800, letterSpacing: 0 }, h2: { fontSize: '1rem', fontWeight: 800, letterSpacing: 0 } },
});

function App() {
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [invariants, setInvariants] = useState(EMPTY_INVARIANTS);
  const [invariantStats, setInvariantStats] = useState({ activeCount: 0, fieldsWithRules: 0 });
  const historyRef = useRef(null);

  useEffect(() => {
    Promise.all([request('/api/memory'), request('/api/invariants')])
      .then(([memoryData, invariantData]) => {
        setMessages(memoryData.shortTermMessages || []);
        setInvariants(invariantData.invariants);
        setInvariantStats(invariantData.stats);
      })
      .catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(() => {
    if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [messages, busy]);

  async function sendMessage(event) {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    const optimisticId = `pending-${Date.now()}`;
    const optimisticMessage = {
      id: optimisticId,
      role: 'user',
      text,
    };

    setBusy(true);
    setError('');
    setMessage('');
    setMessages((current) => [...current, optimisticMessage]);
    try {
      const data = await request('/api/chat', { method: 'POST', body: JSON.stringify({ message: text }) });
      setMessages(data.shortTermMessages || []);
    } catch (requestError) {
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setMessage(text);
      setError(requestError.message);
      if (requestError.code === 'INVARIANT_CONFLICT') setConflict(requestError.data);
    } finally {
      setBusy(false);
    }
  }

  async function clearHistory() {
    setBusy(true);
    try {
      await request('/api/memory', { method: 'DELETE' });
      setMessages([]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveInvariants(nextInvariants) {
    setBusy(true);
    setError('');
    try {
      const data = await request('/api/invariants', { method: 'PUT', body: JSON.stringify({ invariants: nextInvariants }) });
      setInvariants(data.invariants);
      setInvariantStats(data.stats);
      setConflict(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearInvariants() {
    setBusy(true);
    setError('');
    try {
      const data = await request('/api/invariants', { method: 'DELETE' });
      setInvariants(data.invariants);
      setInvariantStats(data.stats);
      setConflict(null);
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
        {error && !conflict && <Alert severity="error">{error}</Alert>}
        {conflict && <Alert severity="warning" onClose={() => setConflict(null)}><strong>Запрос отклонён.</strong> {conflict.error}</Alert>}
        <InvariantsPanel busy={busy} invariants={invariants} onClear={clearInvariants} onSave={saveInvariants} stats={invariantStats} />
        <Paper component="section" elevation={0} sx={{ border: '1px solid rgba(23,33,31,.13)', display: 'grid', flex: 1, gridTemplateRows: 'minmax(0, 1fr) auto', minHeight: 0, overflow: 'hidden' }}>
          <Stack ref={historyRef} spacing={1.25} sx={{ minHeight: 0, overflowY: 'auto', p: { xs: 1.5, md: 2 } }}>
            {messages.length === 0 && <Stack sx={{ alignItems: 'center', color: 'text.secondary', height: '100%', justifyContent: 'center', textAlign: 'center' }}><Typography fontWeight={800}>Диалог начнётся здесь</Typography><Typography variant="body2">Задайте инварианты и проверьте, как агент соблюдает ограничения.</Typography></Stack>}
            {messages.map((item) => <Message key={item.id} message={item} />)}
            {busy && messages.length > 0 && <CircularProgress size={20} />}
          </Stack>
          <Box component="form" onSubmit={sendMessage} sx={{ borderTop: '1px solid rgba(23,33,31,.1)', display: 'flex', gap: 1, p: 1.25 }}>
            <TextField disabled={busy} fullWidth label="Сообщение агенту" multiline maxRows={5} onChange={(event) => setMessage(event.target.value)} value={message} />
            <Tooltip title="Отправить"><span><IconButton aria-label="Отправить" color="primary" disabled={busy || !message.trim()} type="submit" sx={{ height: 48, width: 48 }}><SendRoundedIcon /></IconButton></span></Tooltip>
          </Box>
        </Paper>
      </Box>
    </Box>
  </ThemeProvider>;
}

function Header({ busy, messageCount, onClear }) {
  return <Paper component="header" elevation={0} sx={{ alignItems: 'center', border: '1px solid rgba(23,33,31,.13)', display: 'flex', justifyContent: 'space-between', p: 1.5 }}>
    <Box><Typography component="h1" variant="h1">AI Advent · День 14</Typography><Typography color="text.secondary" variant="body2">Инварианты и ограничения состояния</Typography></Box>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography color="text.secondary" variant="caption">{messageCount} сообщений</Typography><Tooltip title="Очистить диалог"><span><IconButton aria-label="Очистить диалог" color="error" disabled={busy} onClick={onClear}><DeleteSweepRoundedIcon /></IconButton></span></Tooltip></Stack>
  </Paper>;
}

function InvariantsPanel({ busy, invariants, onClear, onSave, stats }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(invariants);

  useEffect(() => setDraft(invariants), [invariants]);

  function close() {
    setDraft(invariants);
    setOpen(false);
  }

  async function submit(event) {
    event.preventDefault();
    await onSave(draft);
    setOpen(false);
  }

  function field(fieldName, label) {
    return <TextField key={fieldName} label={label} minRows={3} multiline onChange={(event) => setDraft((current) => ({ ...current, [fieldName]: event.target.value }))} value={draft[fieldName] || ''} />;
  }

  return <>
    <Paper component="section" elevation={0} sx={{ alignItems: 'center', border: '1px solid rgba(23,33,31,.13)', display: 'flex', gap: 1.25, justifyContent: 'space-between', px: 1.5, py: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
        <ShieldRoundedIcon color={stats.activeCount ? 'primary' : 'disabled'} />
        <Box sx={{ minWidth: 0 }}><Typography component="h2" variant="h2">Инварианты</Typography><Typography color="text.secondary" variant="caption">{stats.activeCount ? `${stats.activeCount} активных правил` : 'Правила пока не заданы'}</Typography></Box>
      </Stack>
      <Tooltip title="Редактировать инварианты"><span><IconButton aria-label="Редактировать инварианты" disabled={busy} onClick={() => setOpen(true)}><EditRoundedIcon /></IconButton></span></Tooltip>
    </Paper>
    <Dialog component="form" fullWidth maxWidth="md" onClose={close} onSubmit={submit} open={open}>
      <DialogTitle>Инварианты</DialogTitle>
      <DialogContent dividers>
        <Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">Одно правило на строку. Для автоматической блокировки используйте формулировки «Не использовать …» или «Использовать только …».</Typography>
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          {field('architecture', 'Архитектура')}
          {field('technicalDecisions', 'Технические решения')}
          {field('stackConstraints', 'Ограничения стека')}
          {field('businessRules', 'Бизнес-правила')}
        </Box>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}><Button color="error" disabled={busy || stats.activeCount === 0} onClick={onClear}>Очистить</Button><Stack direction="row" spacing={1}><Button onClick={close}>Отмена</Button><Button disabled={busy} type="submit" variant="contained">Сохранить</Button></Stack></DialogActions>
    </Dialog>
  </>;
}

function Message({ message }) {
  const isUser = message.role === 'user';
  return <Paper elevation={0} sx={{ alignSelf: isUser ? 'flex-end' : 'flex-start', bgcolor: isUser ? '#e5f1ed' : '#f5f0e9', border: '1px solid rgba(23,33,31,.1)', maxWidth: '82%', p: 1.25 }}>
    <Typography color="text.secondary" fontWeight={800} variant="caption">{isUser ? 'Вы' : 'Агент'}</Typography><Typography sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }} variant="body2">{message.text}</Typography>
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
  if (!response.ok) {
    const requestError = new Error(data.error || 'Ошибка запроса');
    requestError.code = data.code;
    requestError.data = data;
    throw requestError;
  }
  return data;
}

function isJsonResponse(response) {
  if (!response) return false;

  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json');
}

createRoot(document.getElementById('root')).render(<App />);
