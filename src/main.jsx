import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Container, CssBaseline, Drawer, IconButton, Link, List, ListItemButton, ListItemText, Paper, Stack, TextField, ThemeProvider, Typography, createTheme } from '@mui/material';
import './styles.css';

const theme = createTheme({ palette: { mode: 'dark', primary: { main: '#f4b860' }, secondary: { main: '#78dcca' }, background: { default: '#0d1210', paper: '#18211d' } }, typography: { fontFamily: 'Inter, system-ui, sans-serif', h3: { fontWeight: 850, letterSpacing: '-.04em' } }, shape: { borderRadius: 16 } });

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}
const fileUrl = file => `/api/documents/file?path=${encodeURIComponent(file)}`;

function SourceCard({ source }) {
  return <Paper variant="outlined" className="source-card"><Stack direction="row" justifyContent="space-between" gap={1}><Chip size="small" color="secondary" label={source.label} /><Typography variant="caption" color="secondary">{source.score.toFixed(4)}</Typography></Stack><Typography variant="body2" fontWeight={750} mt={1}>{source.source} · {source.section}</Typography><Link href={fileUrl(source.file)} target="_blank" rel="noopener" variant="caption">{source.file} ↗</Link><Typography variant="caption" display="block" color="text.secondary">chunk_id: {source.chunkId}</Typography></Paper>;
}

function AssistantEvidence({ message }) {
  return <Box mt={2}>{message.contextFound ? <><Typography variant="overline" color="secondary">ИСТОЧНИКИ · {message.sources.length}</Typography><Box className="source-grid" mt={0.5}>{message.sources.map(source => <SourceCard key={source.chunkId} source={source} />)}</Box><Box component="details" mt={1.5}><Typography component="summary" variant="body2" color="text.secondary" sx={{ cursor: 'pointer' }}>Дословные цитаты и retrieval</Typography><Stack gap={1} mt={1}>{message.quotes.map((quote, index) => <Paper key={`${quote.sourceLabel}-${index}`} variant="outlined" className="quote-card"><Chip size="small" color="primary" label={quote.sourceLabel} /><Typography variant="body2" mt={1}>«{quote.quote}»</Typography></Paper>)}</Stack>{message.retrieval && <Typography variant="caption" display="block" color="text.secondary" mt={1}>Запрос: {message.retrieval.rewrittenQuery}</Typography>}</Box></> : <Alert severity="warning" variant="outlined">Источники не найдены. Ответ ограничен честным отказом.</Alert>}</Box>;
}

function Message({ message }) {
  const assistant = message.role === 'assistant';
  return <Box className={`message-row ${assistant ? 'assistant-row' : 'user-row'}`}><Card variant="outlined" className={`message-card ${assistant ? 'assistant-message' : 'user-message'}`}><CardContent><Typography variant="overline" color={assistant ? 'secondary' : 'primary'}>{assistant ? 'АССИСТЕНТ' : 'ВЫ'}</Typography><Typography className="message-text">{message.content}</Typography>{assistant && <AssistantEvidence message={message} />}</CardContent></Card></Box>;
}

function MemoryPanel({ state }) {
  const items = [['Цель', state?.goal ? [state.goal] : []], ['Уточнения', state?.clarifications ?? []], ['Ограничения', state?.constraints ?? []]];
  return <Paper variant="outlined" className="memory-panel"><Typography variant="overline" color="primary">ПАМЯТЬ ЗАДАЧИ</Typography>{items.map(([label, values]) => <Box key={label} mt={1.5}><Typography variant="caption" color="text.secondary">{label}</Typography>{values.length ? values.map(value => <Typography variant="body2" key={value}>• {value}</Typography>) : <Typography variant="body2" color="text.disabled">Не зафиксировано</Typography>}</Box>)}<Box mt={1.5}><Typography variant="caption" color="text.secondary">Термины</Typography>{state?.terms?.length ? state.terms.map(item => <Typography variant="body2" key={item.term}><b>{item.term}</b> — {item.meaning}</Typography>) : <Typography variant="body2" color="text.disabled">Не зафиксированы</Typography>}</Box></Paper>;
}

function ConversationList({ conversations, activeId, onSelect, onCreate, onClear, disabled }) {
  return <Box className="conversation-sidebar"><Stack className="sidebar-heading" direction="row" justifyContent="space-between" alignItems="center"><Typography fontWeight={850}>Диалоги</Typography><IconButton className="new-chat-button" color="primary" onClick={onCreate} disabled={disabled} aria-label="Новый диалог"><span className="plus-glyph" aria-hidden="true" /></IconButton></Stack><List className="conversation-list">{conversations.map(item => <ListItemButton key={item.id} selected={item.id === activeId} onClick={() => onSelect(item.id)} disabled={disabled}><ListItemText primary={item.title} secondary={`${item.messageCount} сообщений`} primaryTypographyProps={{ noWrap: true, fontWeight: 700 }} /></ListItemButton>)}</List><Box className="sidebar-footer"><Button fullWidth color="error" variant="outlined" onClick={onClear} disabled={disabled || !conversations.length}>Очистить все чаты</Button></Box></Box>;
}

function App() {
  const [indexState, setIndexState] = useState(null);
  const [settings, setSettings] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const initialized = useRef(false);
  const ready = indexState?.index.available;
  const invalidSettings = !settings || !Number.isInteger(settings.candidateTopK) || settings.candidateTopK < 1 || settings.candidateTopK > 20 || !Number.isInteger(settings.resultTopK) || settings.resultTopK < 1 || settings.resultTopK > settings.candidateTopK || !Number.isFinite(settings.similarityThreshold) || settings.similarityThreshold < -1 || settings.similarityThreshold > 1;
  const activeId = conversation?.id;

  async function loadConversation(id) {
    setError('');
    try { const data = await request(`/api/conversations/${id}`); setConversation(data.conversation); localStorage.setItem('day25-conversation', id); setMobileOpen(false); }
    catch (nextError) { setError(nextError.message); }
  }

  async function createConversation() {
    setBusy(true); setError('');
    try { const data = await request('/api/conversations', { method: 'POST', body: '{}' }); setConversation(data.conversation); localStorage.setItem('day25-conversation', data.conversation.id); setConversations((await request('/api/conversations')).conversations); setMobileOpen(false); }
    catch (nextError) { setError(nextError.message); }
    finally { setBusy(false); }
  }

  async function clearConversations() {
    if (!window.confirm('Удалить все диалоги и их историю? Это действие нельзя отменить.')) return;
    setBusy(true); setError('');
    try {
      await request('/api/conversations', { method: 'DELETE' });
      localStorage.removeItem('day25-conversation');
      const data = await request('/api/conversations', { method: 'POST', body: '{}' });
      setConversation(data.conversation);
      setConversations((await request('/api/conversations')).conversations);
      localStorage.setItem('day25-conversation', data.conversation.id);
      setMobileOpen(false);
    } catch (nextError) { setError(nextError.message); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    Promise.all([request('/api/index'), request('/api/conversations')]).then(async ([index, chats]) => {
      setIndexState(index); setSettings(index.ragDefaults); setConversations(chats.conversations);
      const saved = localStorage.getItem('day25-conversation');
      const id = chats.conversations.some(item => item.id === saved) ? saved : chats.conversations[0]?.id;
      if (id) await loadConversation(id); else await createConversation();
    }).catch(nextError => setError(nextError.message));
  }, []);

  async function buildIndex() {
    setBusy(true); setError('');
    try { await request('/api/index/build', { method: 'POST', body: '{}' }); setIndexState(await request('/api/index')); }
    catch (nextError) { setError(nextError.message); }
    finally { setBusy(false); }
  }

  async function submit(event) {
    event.preventDefault();
    if (!question.trim() || !activeId) return;
    setBusy(true); setError(''); const content = question.trim(); setQuestion('');
    try { const data = await request(`/api/conversations/${activeId}/messages`, { method: 'POST', body: JSON.stringify({ content, settings }) }); setConversation(data.conversation); setConversations((await request('/api/conversations')).conversations); }
    catch (nextError) { setError(nextError.message); setQuestion(content); }
    finally { setBusy(false); }
  }

  const fields = useMemo(() => settings ? [['candidateTopK', 'Кандидаты', 1, 20, 1], ['resultTopK', 'В контексте', 1, settings.candidateTopK, 1], ['similarityThreshold', 'Порог', -1, 1, .01]] : [], [settings]);
  const sidebar = <ConversationList conversations={conversations} activeId={activeId} onSelect={loadConversation} onCreate={createConversation} onClear={clearConversations} disabled={busy} />;
  return <Box className="app-shell"><Box component="aside" className="desktop-sidebar">{sidebar}</Box><Drawer open={mobileOpen} onClose={() => setMobileOpen(false)}>{sidebar}</Drawer><Container maxWidth="xl" component="main" className="chat-main"><Stack className="app-header" direction="row" gap={1} alignItems="center"><IconButton className="mobile-menu" onClick={() => setMobileOpen(true)}>☰</IconButton><Box className="app-title" flex={1}><Typography variant="overline" color="primary">AI ADVENT · ДЕНЬ 25</Typography><Typography variant="h3">RAG-чат с памятью</Typography></Box><Stack className="index-actions" direction="row" alignItems="center"><Chip className="index-status" color={ready ? 'success' : 'warning'} label={ready ? 'индекс готов' : 'индекс не готов'} /><Button className="index-button" variant="outlined" onClick={buildIndex} disabled={busy}>{ready ? 'Переиндексировать' : 'Построить индекс'}</Button></Stack></Stack>{error && <Alert severity="error">{error}</Alert>}<Box className="workspace-grid"><Box className="chat-column"><Paper variant="outlined" className="conversation-heading"><Typography fontWeight={850}>{conversation?.title ?? 'Загрузка…'}</Typography><Typography variant="caption" color="text.secondary">История сохраняется в SQLite</Typography></Paper><Box className="message-list">{!conversation?.messages.length && <Box className="empty-chat"><Typography variant="h6">Начните диалог</Typography><Typography color="text.secondary">Опишите цель и задайте вопрос к локальной базе знаний.</Typography></Box>}{conversation?.messages.map(message => <Message key={message.id} message={message} />)}</Box><Paper component="form" onSubmit={submit} variant="outlined" className="composer"><TextField fullWidth multiline minRows={2} maxRows={6} label="Сообщение" value={question} onChange={event => setQuestion(event.target.value)} inputProps={{ maxLength: 2000 }} disabled={busy} /><Button type="submit" variant="contained" disabled={busy || !question.trim() || !ready || invalidSettings}>{busy ? <CircularProgress size={22} /> : 'Отправить'}</Button></Paper></Box><Stack className="context-column"><MemoryPanel state={conversation?.taskState} /><Paper variant="outlined" className="settings-panel-v2"><Typography variant="overline" color="secondary">RETRIEVAL</Typography>{fields.map(([key, label, min, max, step]) => <TextField key={key} size="small" type="number" label={label} value={settings[key]} onChange={event => setSettings({ ...settings, [key]: Number(event.target.value) })} inputProps={{ min, max, step }} disabled={busy} />)}{invalidSettings && <Typography variant="caption" color="error">Проверьте значения retrieval.</Typography>}</Paper></Stack></Box></Container></Box>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider></React.StrictMode>);
