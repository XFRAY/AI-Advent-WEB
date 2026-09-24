import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Box, Button, Chip, CircularProgress, Container, CssBaseline, Paper, Stack, TextField, ThemeProvider, Typography, createTheme } from '@mui/material';
import './styles.css';
import AltegioLogin from './AltegioLogin.jsx';

const theme = createTheme({ palette: { primary: { main: '#176b57' }, background: { default: '#f4f6f3' } }, typography: { fontFamily: 'Inter, system-ui, sans-serif' }, shape: { borderRadius: 16 } });
const example = 'Какие услуги доступны и сколько стоят?';
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json' } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}
function App() {
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [chatBusy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const busy = chatBusy || authBusy;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const messageList = useRef(null);
  useEffect(() => { request('/api/messages').then(data => setMessages(data.messages)).catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => { const list = messageList.current; if (list && (messages.length || chatBusy)) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' }); }, [messages, chatBusy]);
  async function send(event) {
    event.preventDefault();
    if (!message.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const data = await request('/api/chat', { method: 'POST', body: JSON.stringify({ message }) });
      setMessages(data.messages); setMessage('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function clear() {
    setBusy(true); setError('');
    try { const data = await request('/api/messages', { method: 'DELETE' }); setMessages(data.messages); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <Container maxWidth="md" sx={{ height: '100dvh', minHeight: 560, display: 'flex', flexDirection: 'column', gap: 1.5, py: { xs: 1.5, sm: 2 } }}>
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, flexShrink: 0 }}>
      <Box><Typography variant="overline" color="primary">AI ADVENT / 17</Typography><Typography component="h1" variant="h5" fontWeight={750}>MCP Altegio</Typography></Box>
      <Button variant="outlined" onClick={clear} disabled={busy || loading || !messages.length}>Очистить чат</Button>
    </Stack>
    <AltegioLogin busy={busy} onBusyChange={setAuthBusy} onSessionChange={() => { setMessages([]); setError(''); }} />
    <Paper ref={messageList} role="log" aria-label="История сообщений" variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, flex: 1, minHeight: 120, overflowY: 'auto', overflowWrap: 'anywhere', overscrollBehavior: 'contain' }}>
      <Stack spacing={3} aria-live="polite">
        {loading && <CircularProgress size={22} aria-label="Загрузка истории" />}
        {!loading && !messages.length && <Box sx={{ py: 2, textAlign: 'center' }}>
          <Typography variant="h6" sx={{ mb: 1 }}>С чего начнём?</Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>Агент найдёт услуги в Altegio и использует результат в ответе.</Typography>
          <Button variant="outlined" onClick={() => setMessage(example)}>{example}</Button>
        </Box>}
        {messages.map(item => <Box key={item.id} sx={{ alignSelf: item.role === 'user' ? 'flex-end' : 'stretch', maxWidth: '100%' }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700}>{item.role === 'user' ? 'ВЫ' : 'АГЕНТ'}</Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mt: 0.5 }}>{item.text}</Typography>
          {item.toolCalls?.map((call, index) => <Box component="details" key={index} sx={{ mt: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
            <Box component="summary" sx={{ cursor: 'pointer', overflowWrap: 'anywhere' }}>
              <Chip size="small" label={call.status === 'success' ? 'MCP · выполнено' : 'MCP · ошибка'} color={call.status === 'success' ? 'success' : 'error'} sx={{ mr: 1 }} />{call.name}
            </Box>
            <Typography variant="caption" component="p" sx={{ mt: 2 }}>Параметры</Typography><pre>{JSON.stringify(call.arguments, null, 2)}</pre>
            <Typography variant="caption" component="p">{call.status === 'success' ? 'Результат' : 'Ошибка'}</Typography><pre>{JSON.stringify(call.result, null, 2)}</pre>
          </Box>)}
        </Box>)}
        {busy && <Stack direction="row" sx={{ gap: 1.5, alignItems: "center" }}><CircularProgress size={18} /><Typography color="text.secondary">Обрабатываю запрос…</Typography></Stack>}
      </Stack>
    </Paper>
    {error && <Alert severity="error" sx={{ flexShrink: 0, maxHeight: 80, overflowY: 'auto' }}>{error}</Alert>}
    <Stack component="form" onSubmit={send} direction="row" sx={{ gap: 1, flexShrink: 0, alignItems: 'flex-end' }}>
      <TextField fullWidth multiline maxRows={4} label="Сообщение агенту" value={message} onChange={e => setMessage(e.target.value)} disabled={busy || loading} slotProps={{ htmlInput: { maxLength: 10_000 } }} />
      <Button type="submit" variant="contained" disabled={busy || loading || !message.trim()} sx={{ px: { xs: 1.5, sm: 3 }, minHeight: 56 }}>Отправить</Button>
    </Stack>
    <Typography variant="caption" color="text.secondary" component="p" sx={{ flexShrink: 0 }}>История хранится только до перезапуска сервера.</Typography>
  </Container>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider></React.StrictMode>);
