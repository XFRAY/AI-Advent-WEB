import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Box, Button, Chip, CircularProgress, CssBaseline, LinearProgress, Paper, Stack, TextField, ThemeProvider, Typography, createTheme } from '@mui/material';
import './styles.css';

const theme = createTheme({ palette: { mode: 'dark', primary: { main: '#d7ff64', contrastText: '#10140b' }, secondary: { main: '#8ee8ff' }, background: { default: '#090b08', paper: '#141812' } }, typography: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', h1: { fontWeight: 850, letterSpacing: '-.055em' }, button: { fontWeight: 750, textTransform: 'none' } }, shape: { borderRadius: 18 } });

const examples = ['В каком кафе есть веганские блюда и Wi-Fi?', 'Где можно позавтракать рано утром?', 'Какое кафе подходит для работы с ноутбуком?'];

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}

function StateChip({ ok, children }) { return <Chip size="small" color={ok ? 'primary' : 'default'} variant={ok ? 'filled' : 'outlined'} label={`${ok ? '●' : '○'} ${children}`} />; }

function AnswerCard({ title, subtitle, result, rating, onRate, accent }) {
  const success = result?.status === 'success';
  return <Paper className={`answer-card ${accent}`} variant="outlined">
    <Stack direction="row" justifyContent="space-between" gap={2} alignItems="flex-start"><Box><Typography variant="overline" color={accent === 'local' ? 'primary' : 'secondary'}>{title}</Typography><Typography variant="caption" display="block" color="text.secondary">{subtitle}</Typography></Box><StateChip ok={success}>{success ? 'стабильно' : result?.status === 'unavailable' ? 'не настроено' : 'ошибка'}</StateChip></Stack>
    {success ? <>
      <Typography className="answer-text">{result.answer}</Typography>
      <Stack direction="row" gap={1} flexWrap="wrap"><Chip size="small" label={`${(result.durationMs / 1000).toFixed(1)} сек.`} /><Chip size="small" label={`grounding ✓`} /><Chip size="small" label={`${result.sources.length} источн.`} />{result.evalCount && <Chip size="small" label={`${result.evalCount} токенов`} />}</Stack>
      <Box className="rating"><Typography variant="caption" color="text.secondary">Качество ответа:</Typography><Button size="small" variant={rating === 'up' ? 'contained' : 'text'} onClick={() => onRate('up')}>Полезен</Button><Button size="small" variant={rating === 'down' ? 'contained' : 'text'} color="warning" onClick={() => onRate('down')}>Не помог</Button></Box>
    </> : <Alert severity={result?.status === 'unavailable' ? 'info' : 'error'}>{result?.error || 'Ответ ещё не получен.'}</Alert>}
  </Paper>;
}

function App() {
  const [status, setStatus] = useState(null); const [input, setInput] = useState(''); const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false); const [building, setBuilding] = useState(false); const [error, setError] = useState(''); const [ratings, setRatings] = useState({});
  const loadStatus = useCallback(async () => { try { setStatus(await request('/api/rag/status')); } catch (next) { setError(next.message); } }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function build() { setBuilding(true); setError(''); try { await request('/api/rag/index', { method: 'POST', body: '{}' }); await loadStatus(); } catch (next) { setError(next.message); } finally { setBuilding(false); } }
  async function compare(event) { event.preventDefault(); if (!input.trim() || busy) return; setBusy(true); setError(''); setResult(null); setRatings({}); try { setResult(await request('/api/rag/compare', { method: 'POST', body: JSON.stringify({ question: input.trim() }) })); } catch (next) { setError(next.message); } finally { setBusy(false); } }
  const ready = status?.local.ready && status?.embedding.ready && status?.index.compatible;

  return <Box className="page-shell">
    <Box component="header" className="topbar"><Stack direction="row" alignItems="center" gap={1.2}><Box className="mark">28</Box><Typography fontWeight={850}>AI ADVENT</Typography></Stack><Button variant="outlined" onClick={loadStatus}>Обновить статус</Button></Box>
    <Box component="main" className="rag-layout">
      <Box className="hero"><Typography variant="overline" color="primary">ДЕНЬ 28 · LOCAL RAG</Typography><Typography variant="h1">Знания рядом.<br/><span>Ответы локально.</span></Typography><Typography className="lead" color="text.secondary">Embedding, поиск и Qwen работают через Ollama на вашем компьютере. Облако подключается только для честного сравнения.</Typography>
        <Paper className="pipeline" variant="outlined"><Typography fontWeight={800}>Локальный pipeline</Typography><Stack direction="row" gap={1} flexWrap="wrap"><StateChip ok={status?.embedding.ready}>{status?.embedding.model || 'embeddinggemma'}</StateChip><span>→</span><StateChip ok={status?.index.compatible}>индекс</StateChip><span>→</span><StateChip ok={status?.local.ready}>{status?.local.model || 'qwen3:1.7b'}</StateChip></Stack><Typography variant="caption" color="text.secondary">{status?.corpus ? `${status.corpus.documents} документов · ${status.corpus.tokens} токенов` : 'Проверяем корпус…'}</Typography><Button variant={status?.index.compatible ? 'outlined' : 'contained'} onClick={build} disabled={building || !status?.embedding.ready}>{building ? 'Строим индекс…' : status?.index.compatible ? 'Пересобрать индекс' : 'Построить локальный индекс'}</Button></Paper>
        <Stack direction="row" gap={1} mt={2}><StateChip ok={status?.cloud.configured}>{status?.cloud.configured ? status.cloud.model : 'облако опционально'}</StateChip><StateChip ok={status?.ollama.available}>{status?.ollama.available ? `Ollama ${status.ollama.version || ''}` : 'Ollama offline'}</StateChip></Stack>
      </Box>
      <Paper className="workspace" variant="outlined">
        <Box className="answer-area">
          {busy && <Box className="loading-state"><LinearProgress /><Typography color="text.secondary">Локальный поиск завершится быстро; генерация Qwen может занять до минуты.</Typography></Box>}{error && <Alert severity="error" className="page-error">{error}</Alert>}
          {!result && !busy && <Box className="empty"><Typography variant="h4">Один контекст. Две модели.</Typography><Typography color="text.secondary">Обе модели получают одни и те же четыре локально найденных фрагмента.</Typography>{!ready && <Typography color="warning.main">Подготовьте Ollama и совместимый локальный индекс.</Typography>}</Box>}
          {result && <Box className="results"><Paper className="retrieval-strip" variant="outlined"><b>Retrieval: {result.retrieval.durationMs} мс</b><span>{result.retrieval.model}</span><span>{result.retrieval.sources.length} чанка</span></Paper><Box className="comparison"><AnswerCard title="QWEN · ЛОКАЛЬНО" subtitle="Ollama · данные не покидают компьютер" result={result.local} rating={ratings.local} onRate={value => setRatings(current => ({ ...current, local: value }))} accent="local"/><AnswerCard title="ОБЛАЧНАЯ МОДЕЛЬ" subtitle="Тот же retrieved-контекст" result={result.cloud} rating={ratings.cloud} onRate={value => setRatings(current => ({ ...current, cloud: value }))} accent="cloud"/></Box><Box className="sources"><Typography variant="overline">ИСТОЧНИКИ RETRIEVAL</Typography>{result.retrieval.sources.map(source => <Paper key={source.chunkId} variant="outlined"><b>{source.label} · {source.section}</b><span>{source.file}</span><Chip size="small" label={source.score.toFixed(3)} /></Paper>)}</Box></Box>}
        </Box>
        <Box component="form" className="question-box" onSubmit={compare}><Typography variant="h5" fontWeight={850}>Сравнить ответы</Typography><TextField multiline minRows={2} maxRows={5} fullWidth value={input} onChange={event => setInput(event.target.value)} placeholder="Задайте вопрос по базе кафе…" inputProps={{ maxLength: 2000 }} disabled={busy} /><Stack direction="row" gap={1} flexWrap="wrap">{examples.map(example => <Button key={example} size="small" variant="text" onClick={() => setInput(example)}>{example}</Button>)}</Stack><Button type="submit" variant="contained" size="large" disabled={!ready || busy || !input.trim()}>{busy ? <CircularProgress size={22} /> : 'Запустить сравнение'}</Button></Box>
      </Paper>
    </Box>
  </Box>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider></React.StrictMode>);
