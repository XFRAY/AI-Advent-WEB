import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Box, Button, Chip, CircularProgress, CssBaseline, LinearProgress, Paper, Stack, TextField, ThemeProvider, Typography, createTheme } from '@mui/material';
import './styles.css';

const theme = createTheme({ palette: { mode: 'dark', primary: { main: '#c6ff4a', contrastText: '#10130a' }, secondary: { main: '#78d9ff' }, background: { default: '#080a08', paper: '#141712' } }, typography: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', h1: { fontWeight: 850, letterSpacing: '-.055em' }, button: { fontWeight: 750, textTransform: 'none' } }, shape: { borderRadius: 16 } });
const examples = ['Почему launch в viewModelScope безопаснее GlobalScope?', 'Покажи sealed interface для состояния экрана загрузки.', 'Как исправить утечку Context во ViewModel?'];
const voteOptions = [['baseline', 'Лучше до'], ['optimized', 'Лучше после'], ['equal', 'Равны'], ['neither', 'Оба мимо']];

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}
function bytes(value) { if (!Number.isFinite(value)) return '—'; return value >= 1e9 ? `${(value / 1e9).toFixed(2)} ГБ` : `${Math.round(value / 1e6)} МБ`; }
function duration(value) { return Number.isFinite(value) ? `${(value / 1000).toFixed(2)} с` : '—'; }
function StateChip({ ok, children }) { return <Chip size="small" color={ok ? 'primary' : 'default'} variant={ok ? 'filled' : 'outlined'} label={`${ok ? '●' : '○'} ${children}`} />; }

function ProfileCard({ profile, accent }) {
  if (!profile) return null;
  return <Paper className={`profile-card ${accent}`} variant="outlined">
    <Stack direction="row" justifyContent="space-between" gap={1}><Typography variant="overline" color={accent === 'after' ? 'primary' : 'secondary'}>{profile.label}</Typography><StateChip ok={profile.installed}>{profile.installed ? 'готово' : 'нет модели'}</StateChip></Stack>
    <Typography fontWeight={850}>{profile.model}</Typography>
    <Box className="parameter-grid"><span>quant</span><b>{profile.quantization}</b><span>temperature</span><b>{profile.options.temperature}</b><span>context</span><b>{profile.options.num_ctx}</b><span>max tokens</span><b>{profile.options.num_predict}</b><span>диск</span><b>{bytes(profile.sizeBytes)}</b></Box>
  </Paper>;
}

function Metrics({ result }) {
  if (result?.status !== 'success') return null;
  const m = result.metrics || {}; const r = result.resources || {};
  return <Box className="metrics"><span><b>{duration(m.wallMs)}</b> ответ</span><span><b>{m.tokensPerSecond ?? '—'}</b> ток/с</span><span><b>{m.outputTokens ?? '—'}</b> токенов</span><span><b>{bytes(r.residentBytes)}</b> RAM</span><span><b>{bytes(r.vramBytes)}</b> VRAM</span></Box>;
}

function Answer({ result, kind }) {
  const success = result?.status === 'success';
  return <Paper className={`answer-card ${kind}`} variant="outlined">
    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}><Typography variant="overline" color={kind === 'optimized' ? 'primary' : 'secondary'}>{kind === 'baseline' ? 'ДО · Q8' : 'ПОСЛЕ · Q4'}</Typography><Chip size="small" variant="outlined" label={result?.model || 'модель'} /></Stack>
    {success ? <><Typography className="answer-text">{result.answer}</Typography><Metrics result={result} /></> : <Alert severity="error">{result?.error || 'Ответ не получен.'}</Alert>}
  </Paper>;
}

function Vote({ value, onChange }) {
  return <Box className="vote"><Typography variant="caption" color="text.secondary">Какой ответ качественнее?</Typography><Stack direction="row" gap={.5} flexWrap="wrap">{voteOptions.map(([id, label]) => <Button key={id} size="small" variant={value === id ? 'contained' : 'text'} onClick={() => onChange(id)}>{label}</Button>)}</Stack></Box>;
}

function Pair({ item, vote, onVote }) {
  return <Box className="pair"><Box className="task-title">{item.category && <Chip size="small" label={item.category} />}<Box><Typography fontWeight={850}>{item.title || 'Произвольный вопрос'}</Typography><Typography variant="body2" color="text.secondary">{item.prompt}</Typography></Box></Box><Box className="comparison"><Answer result={item.baseline} kind="baseline"/><Answer result={item.optimized} kind="optimized"/></Box><Vote value={vote} onChange={onVote}/></Box>;
}

function ChatTurn({ item, vote, onVote }) {
  return <Box className="chat-turn"><Box className="user-row"><Paper className="user-bubble">{item.prompt}</Paper></Box><Box className="assistant-row"><Box className="comparison"><Answer result={item.baseline} kind="baseline"/><Answer result={item.optimized} kind="optimized"/></Box><Vote value={vote} onChange={onVote}/></Box></Box>;
}

function Summary({ tasks, votes }) {
  const successful = tasks.flatMap(task => [task.baseline, task.optimized]).filter(item => item.status === 'success');
  const byProfile = key => tasks.map(task => task[key]).filter(item => item.status === 'success');
  const average = (items, field) => items.length ? items.reduce((sum, item) => sum + (item.metrics?.[field] || 0), 0) / items.length : null;
  const baseline = byProfile('baseline'); const optimized = byProfile('optimized');
  const counts = Object.values(votes).reduce((acc, vote) => ({ ...acc, [vote]: (acc[vote] || 0) + 1 }), {});
  return <Paper className="summary" variant="outlined"><Typography variant="overline" color="primary">ИТОГ ЭКСПЕРИМЕНТА</Typography><Box className="summary-grid"><span><b>{Object.keys(votes).length}/{tasks.length}</b> оценено</span><span><b>{counts.optimized || 0}</b> побед «после»</span><span><b>{duration(average(baseline, 'wallMs'))}</b> среднее до</span><span><b>{duration(average(optimized, 'wallMs'))}</b> среднее после</span><span><b>{Math.round(average(baseline, 'tokensPerSecond') || 0)}</b> ток/с до</span><span><b>{Math.round(average(optimized, 'tokensPerSecond') || 0)}</b> ток/с после</span></Box>{successful.length === 0 && <Alert severity="warning">Нет успешных измерений.</Alert>}</Paper>;
}

function App() {
  const [status, setStatus] = useState(null); const [input, setInput] = useState(examples[0]); const [history, setHistory] = useState([]); const [pendingPrompt, setPendingPrompt] = useState(''); const [tasks, setTasks] = useState([]);
  const [mode, setMode] = useState('compare'); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [chatVotes, setChatVotes] = useState({}); const [benchmarkVotes, setBenchmarkVotes] = useState({});
  const historyEndRef = useRef(null);
  const loadStatus = useCallback(async () => { try { setStatus(await request('/api/optimization/status')); } catch (next) { setError(next.message); } }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  const ready = status?.ollama.available && status?.profiles.baseline.installed && status?.profiles.optimized.installed;
  const voteSummary = useMemo(() => Object.values(benchmarkVotes).filter(Boolean), [benchmarkVotes]);
  useEffect(() => { if (mode === 'compare') historyEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [history, pendingPrompt, mode]);

  async function compare(event) { event.preventDefault(); if (!input.trim() || busy) return; const prompt = input.trim(); setBusy(true); setError(''); setPendingPrompt(prompt); setInput(''); try { const data = await request('/api/optimization/compare', { method: 'POST', body: JSON.stringify({ prompt }) }); setHistory(current => [...current, { id: `${Date.now()}-${current.length}`, ...data }]); } catch (next) { setError(next.message); setInput(prompt); } finally { setPendingPrompt(''); setBusy(false); loadStatus(); } }
  async function benchmark() { if (busy) return; setBusy(true); setError(''); setTasks([]); setBenchmarkVotes({}); try { const data = await request('/api/optimization/benchmark', { method: 'POST', body: '{}' }); setTasks(data.tasks); } catch (next) { setError(next.message); } finally { setBusy(false); loadStatus(); } }

  return <Box className="page-shell"><Box component="header" className="topbar"><Stack direction="row" alignItems="center" gap={1.2}><Box className="mark">29</Box><Typography fontWeight={850}>AI ADVENT</Typography></Stack><Stack direction="row" gap={1}><StateChip ok={status?.ollama.available}>{status?.ollama.available ? `Ollama ${status.ollama.version || ''}` : 'Ollama offline'}</StateChip><Button variant="outlined" onClick={loadStatus}>Обновить</Button></Stack></Box>
    <Box component="main" className="optimization-layout"><Box className="hero"><Typography variant="overline" color="primary">ДЕНЬ 29 · LOCAL LLM LAB</Typography><Typography variant="h1">Меньше веса.<br/><span>Больше пользы.</span></Typography><Typography className="lead" color="text.secondary">Оптимизируем локального Kotlin/Android-помощника: prompt, параметры и Q4-квантование против Q8-базы.</Typography><Box className="profiles"><ProfileCard profile={status?.profiles.baseline} accent="before"/><ProfileCard profile={status?.profiles.optimized} accent="after"/></Box></Box>
      <Paper className="workspace" variant="outlined"><Box className="modebar"><Button variant={mode === 'compare' ? 'contained' : 'text'} onClick={() => setMode('compare')}>Чат</Button><Button variant={mode === 'benchmark' ? 'contained' : 'text'} onClick={() => setMode('benchmark')}>Benchmark · 4 задачи</Button>{mode === 'compare' && history.length > 0 && <Button className="clear-chat" size="small" color="inherit" onClick={() => { setHistory([]); setChatVotes({}); }}>Очистить</Button>}<Typography variant="caption" color="text.secondary">warm-up → замер → unload</Typography></Box>
        <Box className="answer-area">{error && <Alert severity="error" className="page-error">{error}</Alert>}
          {mode === 'compare' && history.length === 0 && !pendingPrompt && <Box className="empty chat-empty"><Typography variant="h4">История ответов появится здесь</Typography><Typography color="text.secondary">Каждый вопрос останется в списке вместе с ответами Q8 и Q4.</Typography>{!ready && <Alert severity="warning">Запустите Ollama и установите обе модели.</Alert>}</Box>}
          {mode === 'compare' && (history.length > 0 || pendingPrompt) && <Box className="chat-history">{history.map(item => <ChatTurn key={item.id} item={item} vote={chatVotes[item.id]} onVote={value => setChatVotes(current => ({ ...current, [item.id]: value }))}/>)}{pendingPrompt && <Box className="chat-turn pending"><Box className="user-row"><Paper className="user-bubble">{pendingPrompt}</Paper></Box><Paper className="thinking-bubble" variant="outlined"><LinearProgress/><Typography variant="body2">Q8 и Q4 отвечают последовательно…</Typography></Paper></Box>}<div ref={historyEndRef}/></Box>}
          {busy && mode === 'benchmark' && <Box className="loading-state"><LinearProgress/><Typography>Модели запускаются последовательно. Это может занять несколько минут.</Typography></Box>}
          {!busy && mode === 'benchmark' && tasks.length === 0 && <Box className="empty"><Typography variant="h4">4 Android-задачи</Typography><Typography color="text.secondary">Kotlin, Coroutines, Lifecycle и Compose. После прогона оцените каждую пару.</Typography><Button variant="contained" size="large" disabled={!ready} onClick={benchmark}>Запустить benchmark</Button></Box>}
          {!busy && mode === 'benchmark' && tasks.length > 0 && <Box className="results"><Summary tasks={tasks} votes={benchmarkVotes}/>{tasks.map(task => <Pair key={task.id} item={task} vote={benchmarkVotes[task.id]} onVote={value => setBenchmarkVotes(current => ({ ...current, [task.id]: value }))}/>)}</Box>}
        </Box>
        {mode === 'compare' && <Box component="form" className="question-box" onSubmit={compare}><TextField multiline minRows={2} maxRows={5} fullWidth value={input} onChange={event => setInput(event.target.value)} placeholder="Вопрос по Kotlin или Android…" inputProps={{ maxLength: 4000 }} disabled={busy}/><Button type="submit" variant="contained" size="large" disabled={!ready || busy || !input.trim()}>{busy ? <CircularProgress size={22}/> : 'Сравнить'}</Button><Stack direction="row" gap={.5} flexWrap="wrap">{examples.map(example => <Button key={example} size="small" onClick={() => setInput(example)}>{example}</Button>)}</Stack></Box>}
        {mode === 'benchmark' && tasks.length > 0 && <Box className="benchmark-footer"><Typography variant="caption" color="text.secondary">Оценено: {voteSummary.length} из {tasks.length}</Typography><Button variant="outlined" disabled={busy || !ready} onClick={benchmark}>Повторить benchmark</Button></Box>}
      </Paper></Box></Box>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline/><App/></ThemeProvider></React.StrictMode>);
