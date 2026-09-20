import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { Alert, Box, Button, Chip, CircularProgress, CssBaseline, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Stack, TextField, ThemeProvider, Tooltip, Typography, createTheme } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const EMPTY_INVARIANTS = { architecture: '', technicalDecisions: '', stackConstraints: '', businessRules: '' };
const EMPTY_LIFECYCLE = { stage: 'planning', availableIntents: ['planning', 'reset'], artifacts: { plan: null, implementationResults: [], validationResults: [] } };
const STAGE_LABELS = { planning: 'Планирование', implementation: 'Реализация', validation: 'Валидация', done: 'Завершено' };
const STAGES = ['planning', 'implementation', 'validation', 'done'];

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
  const [taskLifecycle, setTaskLifecycle] = useState(EMPTY_LIFECYCLE);
  const historyRef = useRef(null);
  const transitionActions = getTransitionActions(taskLifecycle);

  useEffect(() => {
    Promise.all([request('/api/memory'), request('/api/invariants'), request('/api/task-lifecycle')])
      .then(([memoryData, invariantData, lifecycleData]) => {
        setMessages(memoryData.shortTermMessages || []);
        setInvariants(invariantData.invariants);
        setInvariantStats(invariantData.stats);
        setTaskLifecycle(lifecycleData.taskLifecycle);
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
    setConflict(null);
    setMessage('');
    setMessages((current) => [...current, optimisticMessage]);
    try {
      const data = await request('/api/chat', { method: 'POST', body: JSON.stringify({ message: text }) });
      setMessages(data.shortTermMessages || []);
      setTaskLifecycle(data.taskLifecycle || EMPTY_LIFECYCLE);
      setConflict(null);
    } catch (requestError) {
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setMessage(text);
      setError(requestError.message);
      if (requestError.code === 'INVARIANT_CONFLICT' || requestError.code === 'LIFECYCLE_TRANSITION_BLOCKED') {
        setConflict(requestError.data);
        if (requestError.data.taskLifecycle) setTaskLifecycle(requestError.data.taskLifecycle);
      }
    } finally {
      setBusy(false);
    }
  }

  async function runLifecycleAction(messageText) {
    setBusy(true);
    setError('');
    setConflict(null);
    try {
      const data = await request('/api/chat', { method: 'POST', body: JSON.stringify({ message: messageText }) });
      setMessages(data.shortTermMessages || []);
      setTaskLifecycle(data.taskLifecycle || EMPTY_LIFECYCLE);
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.code === 'INVARIANT_CONFLICT' || requestError.code === 'LIFECYCLE_TRANSITION_BLOCKED') {
        setConflict(requestError.data);
        if (requestError.data.taskLifecycle) setTaskLifecycle(requestError.data.taskLifecycle);
      }
    } finally {
      setBusy(false);
    }
  }

  async function clearHistory() {
    setBusy(true);
    try {
      const data = await request('/api/memory', { method: 'DELETE' });
      setMessages([]);
      setTaskLifecycle(data.taskLifecycle || EMPTY_LIFECYCLE);
      setConflict(null);
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
        <WorkspaceHeader
          busy={busy}
          invariantStats={invariantStats}
          invariants={invariants}
          lifecycle={taskLifecycle}
          messageCount={messages.length}
          onClearHistory={clearHistory}
          onClearInvariants={clearInvariants}
          onSaveInvariants={saveInvariants}
        />
        {error && !conflict && <Alert severity="error">{error}</Alert>}
        {conflict && <Alert severity="warning" onClose={() => setConflict(null)}><strong>Запрос отклонён.</strong> {conflict.error}</Alert>}
        <Paper component="section" elevation={0} sx={{ border: '1px solid rgba(23,33,31,.13)', display: 'grid', flex: 1, gridTemplateRows: transitionActions.length ? 'minmax(0, 1fr) auto auto' : 'minmax(0, 1fr) auto', minHeight: 0, overflow: 'hidden' }}>
          <Stack ref={historyRef} spacing={1.25} sx={{ minHeight: 0, overflowY: 'auto', p: { xs: 1.5, md: 2 } }}>
            {messages.length === 0 && <Stack sx={{ alignItems: 'center', color: 'text.secondary', height: '100%', justifyContent: 'center', textAlign: 'center' }}><Typography fontWeight={800}>Диалог начнётся здесь</Typography><Typography variant="body2">Задайте инварианты и проверьте, как агент соблюдает ограничения.</Typography></Stack>}
            {messages.map((item) => <Message key={item.id} message={item} />)}
            {busy && messages.length > 0 && <CircularProgress size={20} />}
          </Stack>
          {transitionActions.length > 0 && <Box sx={{ alignItems: 'center', borderTop: '1px solid rgba(23,33,31,.1)', display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'flex-end', px: 1.25, py: 0.75 }}>
            <Typography color="text.secondary" variant="caption">{transitionActions.some((action) => !action.secondary) ? 'Следующий этап готов' : 'Нужно изменить план?'}</Typography>
            {transitionActions.map((action) => <Button disabled={busy} key={action.command} onClick={() => runLifecycleAction(action.command)} size="small" variant={action.secondary ? 'outlined' : 'contained'}>{action.label}</Button>)}
          </Box>}
          <Box component="form" onSubmit={sendMessage} sx={{ borderTop: '1px solid rgba(23,33,31,.1)', display: 'flex', gap: 1, p: 1.25 }}>
            <TextField disabled={busy} fullWidth label="Сообщение агенту" multiline maxRows={5} onChange={(event) => setMessage(event.target.value)} value={message} />
            <Tooltip title="Отправить"><span><IconButton aria-label="Отправить" color="primary" disabled={busy || !message.trim()} type="submit" sx={{ height: 48, width: 48 }}><SendRoundedIcon /></IconButton></span></Tooltip>
          </Box>
        </Paper>
      </Box>
    </Box>
  </ThemeProvider>;
}

function WorkspaceHeader({ busy, invariantStats, invariants, lifecycle, messageCount, onClearHistory, onClearInvariants, onSaveInvariants }) {
  const [invariantsOpen, setInvariantsOpen] = useState(false);
  const [draft, setDraft] = useState(invariants);
  const currentIndex = Math.max(0, STAGES.indexOf(lifecycle.stage));
  const guidance = getLifecycleGuidance(lifecycle);

  useEffect(() => setDraft(invariants), [invariants]);

  function close() {
    setDraft(invariants);
    setInvariantsOpen(false);
  }

  async function submit(event) {
    event.preventDefault();
    await onSaveInvariants(draft);
    setInvariantsOpen(false);
  }

  function field(fieldName, label) {
    return <TextField key={fieldName} label={label} minRows={3} multiline onChange={(event) => setDraft((current) => ({ ...current, [fieldName]: event.target.value }))} value={draft[fieldName] || ''} />;
  }

  return <>
    <Paper component="header" elevation={0} sx={{ border: '1px solid rgba(23,33,31,.13)', px: { xs: 1.25, md: 1.5 }, py: 1 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}><Typography component="h1" variant="h1">AI Advent · День 15</Typography><Typography color="text.secondary" noWrap variant="caption">Контролируемые переходы состояний</Typography></Box>
        <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', flexShrink: 0 }}>
          <Tooltip title={`${invariantStats.activeCount} активных правил`}><Chip icon={<ShieldRoundedIcon />} label={`${invariantStats.activeCount} правил`} onClick={() => setInvariantsOpen(true)} size="small" variant="outlined" /></Tooltip>
          <Tooltip title="Редактировать инварианты"><span><IconButton aria-label="Редактировать инварианты" disabled={busy} onClick={() => setInvariantsOpen(true)} size="small"><EditRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
          <Typography color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' }, mx: 0.5 }} variant="caption">{messageCount} сообщений</Typography>
          <Tooltip title="Очистить диалог"><span><IconButton aria-label="Очистить диалог" color="error" disabled={busy} onClick={onClearHistory} size="small"><DeleteSweepRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
        </Stack>
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { sm: 'center' }, borderTop: '1px solid rgba(23,33,31,.1)', gap: { xs: 0.5, sm: 1.5 }, justifyContent: 'space-between', mt: 0.75, pt: 0.75 }}>
        <Stack direction="row" sx={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
          <AccountTreeRoundedIcon color="primary" sx={{ fontSize: 18, mr: 0.75 }} />
          {STAGES.map((stage, index) => {
            const completed = index < currentIndex || lifecycle.stage === 'done';
            const current = index === currentIndex && lifecycle.stage !== 'done';
            const allowed = (lifecycle.allowedTransitions || []).some((transition) => transition.to === stage);
            return <React.Fragment key={stage}>
              {index > 0 && <Box sx={{ bgcolor: completed ? 'primary.main' : 'rgba(23,33,31,.16)', flex: 1, height: 1, minWidth: 5 }} />}
              <Tooltip title={`${STAGE_LABELS[stage]}: ${completed ? 'пройден' : current ? 'текущий этап' : allowed ? 'доступен' : 'закрыт'}`}>
                <Stack direction="row" sx={{ alignItems: 'center', flexShrink: 0, gap: 0.4 }}>
                  <Box sx={{ alignItems: 'center', bgcolor: completed ? 'primary.main' : current ? '#e5f1ed' : '#eef0ed', border: current ? '2px solid #176b5b' : '1px solid rgba(23,33,31,.15)', borderRadius: '50%', color: completed ? '#fff' : current ? 'primary.main' : 'text.secondary', display: 'flex', height: 22, justifyContent: 'center', width: 22 }}>
                    {completed ? <CheckRoundedIcon sx={{ fontSize: 14 }} /> : index > currentIndex && !allowed ? <LockRoundedIcon sx={{ fontSize: 12 }} /> : <Typography fontWeight={800} sx={{ fontSize: '0.65rem' }}>{index + 1}</Typography>}
                  </Box>
                  <Typography color={current ? 'primary.main' : 'text.secondary'} fontWeight={current || completed ? 800 : 500} sx={{ display: { xs: index === currentIndex ? 'block' : 'none', md: 'block' }, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{STAGE_LABELS[stage]}</Typography>
                </Stack>
              </Tooltip>
            </React.Fragment>;
          })}
        </Stack>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}>
          <Typography color="text.secondary" noWrap variant="caption">{guidance.title}</Typography>
        </Stack>
      </Stack>
    </Paper>
    <Dialog component="form" fullWidth maxWidth="md" onClose={close} onSubmit={submit} open={invariantsOpen}>
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
      <DialogActions sx={{ justifyContent: 'space-between' }}><Button color="error" disabled={busy || invariantStats.activeCount === 0} onClick={onClearInvariants}>Очистить</Button><Stack direction="row" spacing={1}><Button onClick={close}>Отмена</Button><Button disabled={busy} type="submit" variant="contained">Сохранить</Button></Stack></DialogActions>
    </Dialog>
  </>;
}

function getLifecycleGuidance(lifecycle) {
  if (lifecycle.stage === 'planning') {
    if (lifecycle.artifacts?.plan?.needsRevision) return { title: 'План на пересмотре: опишите изменения' };
    if (lifecycle.artifacts?.plan?.hasOpenQuestions) return { title: 'Ответьте на вопросы по требованиям' };
    return lifecycle.artifacts?.plan ? { title: 'План готов к утверждению' } : { title: 'Соберите требования и план' };
  }
  if (lifecycle.stage === 'implementation') return lifecycle.artifacts?.implementationResults?.length ? { title: 'Можно переходить к проверке' } : { title: 'Выполните реализацию' };
  if (lifecycle.stage === 'validation') return lifecycle.artifacts?.validationResults?.length ? { title: 'Можно завершать или вернуть на доработку' } : { title: 'Нужна проверка' };
  return { title: 'Задача завершена' };
}

function getTransitionActions(lifecycle) {
  const intents = new Set(lifecycle.availableIntents || []);
  if (lifecycle.stage === 'planning' && intents.has('approve_plan')) return [{ label: 'Подтверждаю, к реализации', command: 'Утверждаю план' }];
  if (lifecycle.stage === 'implementation') {
    return [
      intents.has('validation') && { label: 'Перейти к проверке', command: 'Проверь реализацию' },
      intents.has('replan') && { label: 'Пересмотреть план', command: 'Пересмотреть план', secondary: true },
    ].filter(Boolean);
  }
  if (lifecycle.stage === 'validation') {
    return [
      intents.has('finalize') && { label: 'Завершить задачу', command: 'Финализируй задачу' },
      intents.has('rework') && { label: 'На доработку', command: 'Доработать', secondary: true },
    ].filter(Boolean);
  }
  if (lifecycle.stage === 'done') return [{ label: 'Новая задача', command: 'Сбросить' }];
  return [];
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
