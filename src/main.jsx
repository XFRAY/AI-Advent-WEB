import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Box, Button, Chip, CircularProgress, Container, CssBaseline, Link, Paper, Stack, TextField, ThemeProvider, Typography, createTheme } from '@mui/material';
import './styles.css';
import AltegioLogin from './AltegioLogin.jsx';

const theme = createTheme({ palette: { primary: { main: '#176b57' }, background: { default: '#f4f6f3' } }, typography: { fontFamily: 'Inter, system-ui, sans-serif' }, shape: { borderRadius: 16 } });
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
    try { const data = await request('/api/messages', { method: 'DELETE' }); setMessages(data.messages); setMessage(''); setError(''); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <Container maxWidth="xl" className="app-shell" sx={{ height: '100dvh', minHeight: 'min(560px, 100dvh)', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 1.5, py: { xs: 1.5, sm: 2 } }}>
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, flexShrink: 0 }}>
      <Box><Typography variant="overline" color="primary">AI ADVENT / 19</Typography><Typography component="h1" variant="h5" fontWeight={750}>Композиция MCP-инструментов</Typography></Box>
      <Button variant="outlined" onClick={clear} disabled={busy || loading}>Очистить чат</Button>
    </Stack>
    <Box className="workspace">
    <Stack className="settings-pane" spacing={1.5}>
    <AltegioLogin busy={busy} onBusyChange={setAuthBusy} onSessionChange={() => { setMessages([]); setError(''); }} />
    </Stack>
    <Box className="chat-pane">
    <Paper ref={messageList} role="log" aria-label="История сообщений" variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, flex: 1, minHeight: 0, overflowY: 'auto', overflowWrap: 'anywhere', overscrollBehavior: 'contain' }}>
      <Stack spacing={3} aria-live="polite">
        {loading && <CircularProgress size={22} aria-label="Загрузка истории" />}
        {!loading && !messages.length && <Box sx={{ py: 2, textAlign: 'center' }}>
          <Typography variant="h6">С чего начнём?</Typography>
        </Box>}
        {messages.map(item => <Box key={item.id} sx={{ alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: { xs: '92%', sm: '80%' }, display: 'flex', flexDirection: 'column', alignItems: item.role === 'user' ? 'flex-end' : 'flex-start' }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ px: 1 }}>{item.role === 'user' ? 'ВЫ' : 'АГЕНТ'}</Typography>
          <Typography className={`bubble bubble-${item.role}`} sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mt: 0.5 }}>{item.text}</Typography>
          {item.toolCalls?.filter(call => call.name === 'pipeline_save_to_file' && call.status === 'success' && call.result?.file).map(call =>
            <Link key={call.result.file} href={`/api/reports/${encodeURIComponent(call.result.file)}`} target="_blank" rel="noopener" sx={{ display: 'inline-block', mt: 1, fontWeight: 600 }}>Открыть отчёт {call.result.file}</Link>)}
          {item.toolCalls?.map((call, index) => <Box component="details" key={index} sx={{ mt: 1, alignSelf: 'stretch', border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
            <Box component="summary" sx={{ cursor: 'pointer', overflowWrap: 'anywhere' }}>
              <Chip size="small" label={{ success: 'MCP · выполнено', error: 'MCP · ошибка', skipped: 'MCP · пропущен' }[call.status]} color={{ success: 'success', error: 'error', skipped: 'default' }[call.status]} sx={{ mr: 1 }} />{call.name}
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
    <Typography variant="caption" color="text.secondary" component="p" sx={{ flexShrink: 0 }}>Отчёты сохраняются в data/reports. История чата — до перезапуска сервера.</Typography>
    </Box>
    </Box>
  </Container>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider></React.StrictMode>);
