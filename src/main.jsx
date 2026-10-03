import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Container, CssBaseline, FormControlLabel, Link, LinearProgress, Paper, Stack, TextField, ThemeProvider, Typography, createTheme } from '@mui/material';
import './styles.css';

const theme = createTheme({
  palette: { mode: 'dark', primary: { main: '#f4b860' }, secondary: { main: '#78dcca' }, background: { default: '#101513', paper: '#19211e' } },
  typography: { fontFamily: 'Inter, system-ui, sans-serif', h2: { fontWeight: 850, letterSpacing: '-.045em' } },
  shape: { borderRadius: 16 },
});

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}

const fileUrl = file => `/api/documents/file?path=${encodeURIComponent(file)}`;

function SourceCard({ source, candidate = false }) {
  const state = source.retained ? 'в контексте' : source.passedThreshold ? 'отсечён top-K' : 'ниже порога';
  return <Paper variant="outlined" className={`source-card ${candidate && !source.retained ? 'rejected-source' : ''}`}>
    <Stack direction="row" justifyContent="space-between" gap={1} alignItems="center">
      <Chip size="small" color={source.retained || !candidate ? 'secondary' : 'default'} label={candidate ? state : source.label} />
      <Typography variant="caption" color={source.passedThreshold === false ? 'text.secondary' : 'secondary'}>similarity {source.score.toFixed(4)}</Typography>
    </Stack>
    <Typography variant="body2" fontWeight={700} mt={1}>{source.section}</Typography>
    <Link href={fileUrl(source.file)} target="_blank" rel="noopener" variant="caption">{source.file} ↗</Link>
    <Typography variant="body2" className="source-text" mt={1}>{source.text}</Typography>
  </Paper>;
}

function AnswerCard({ title, result, improved = false }) {
  const successful = result?.status === 'success';
  return <Card variant="outlined" className={improved ? 'answer-card rag-card' : 'answer-card'}>
    <CardContent>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} mb={2}>
        <Typography variant="overline" color={improved ? 'secondary' : 'primary'}>{title}</Typography>
        {result && <Chip size="small" color={successful ? 'success' : 'error'} label={`${result.durationMs} мс`} />}
      </Stack>
      {!result && <Typography color="text.secondary">Ответ появится здесь.</Typography>}
      {result && !successful && <Alert severity="error">{result.error}</Alert>}
      {successful && improved && <Paper variant="outlined" className="rewrite-box">
        <Typography variant="caption" color="text.secondary">QUERY REWRITE</Typography>
        <Typography>{result.rewrittenQuery}</Typography>
        <Stack direction="row" gap={1} mt={1} flexWrap="wrap">
          <Chip size="small" label={`кандидатов: ${result.filtering.candidateCount}`} />
          <Chip size="small" label={`прошли порог: ${result.filtering.thresholdPassedCount}`} />
          <Chip size="small" color="secondary" label={`в контексте: ${result.filtering.retainedCount}`} />
        </Stack>
      </Paper>}
      {successful && <Typography className="answer-text" mt={improved ? 2 : 0}>{result.answer}</Typography>}
      {successful && !improved && result.sources?.length > 0 && <Box component="details" mt={2}>
        <Typography component="summary" color="primary" fontWeight={750} sx={{ cursor: 'pointer' }}>Источники ({result.sources.length})</Typography>
        <Stack gap={1} mt={1.5}>{result.sources.map(source => <SourceCard key={source.chunkId} source={source} />)}</Stack>
      </Box>}
      {successful && improved && result.candidates?.length > 0 && <Box component="details" mt={2}>
        <Typography component="summary" color="secondary" fontWeight={750} sx={{ cursor: 'pointer' }}>Все кандидаты ({result.candidates.length})</Typography>
        <Stack gap={1} mt={1.5}>{result.candidates.map(source => <SourceCard key={source.chunkId} source={source} candidate />)}</Stack>
      </Box>}
    </CardContent>
  </Card>;
}

function Rating({ checked, onChange, label }) {
  return <FormControlLabel control={<Checkbox checked={Boolean(checked)} onChange={event => onChange(event.target.checked)} />} label={label} />;
}

function EvaluationItem({ item, result, ratings, onRate }) {
  return <Paper component="details" variant="outlined" className="evaluation-item">
    <Box component="summary" className="evaluation-summary">
      <Chip size="small" label={item.id} />
      <Typography fontWeight={750}>{item.question}</Typography>
      <Chip size="small" color={result ? 'success' : 'default'} label={result ? 'готово' : 'не запускался'} />
    </Box>
    <Box className="evaluation-body">
      <Typography variant="caption" color="text.secondary">ОЖИДАНИЕ</Typography>
      <Typography mb={1.5}>{item.expectation}</Typography>
      <Typography variant="caption" color="text.secondary">ЦЕЛЕВЫЕ ИСТОЧНИКИ</Typography>
      <Stack gap={0.4} mt={0.5} mb={2}>{item.sources.map(source => <Typography variant="body2" key={source}>• {source}</Typography>)}</Stack>
      {result && <Box className="mini-comparison">
        {[['rawRag', 'Raw RAG'], ['improvedRag', 'Improved RAG']].map(([mode, label]) => <Box key={mode}>
          <Typography variant="overline" color={mode === 'improvedRag' ? 'secondary' : 'primary'}>{label}</Typography>
          {result[mode].status === 'success' ? <Typography className="mini-answer">{result[mode].answer}</Typography> : <Alert severity="error">{result[mode].error}</Alert>}
          <Rating checked={ratings?.[mode]} onChange={value => onRate(item.id, mode, value)} label="Соответствует ожиданию" />
        </Box>)}
      </Box>}
    </Box>
  </Paper>;
}

function Settings({ value, onChange, disabled }) {
  if (!value) return null;
  const field = key => event => onChange({ ...value, [key]: Number(event.target.value) });
  return <Paper variant="outlined" className="settings-panel">
    <Box><Typography variant="overline" color="secondary">НАСТРОЙКИ RETRIEVAL</Typography><Typography variant="body2" color="text.secondary">Параметры применяются к одиночному и контрольному прогонам.</Typography></Box>
    <TextField size="small" type="number" label="Top-K до фильтра" value={value.candidateTopK} onChange={field('candidateTopK')} disabled={disabled} inputProps={{ min: 1, max: 20, step: 1 }} />
    <TextField size="small" type="number" label="Top-K после фильтра" value={value.resultTopK} onChange={field('resultTopK')} disabled={disabled} inputProps={{ min: 1, max: value.candidateTopK, step: 1 }} />
    <TextField size="small" type="number" label="Similarity threshold" value={value.similarityThreshold} onChange={field('similarityThreshold')} disabled={disabled} inputProps={{ min: -1, max: 1, step: 0.01 }} />
  </Paper>;
}

function App() {
  const [indexState, setIndexState] = useState(null);
  const [settings, setSettings] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [question, setQuestion] = useState('От какой суммы доставка бесплатная?');
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [evaluationBusy, setEvaluationBusy] = useState(false);
  const [evaluationResults, setEvaluationResults] = useState({});
  const [ratings, setRatings] = useState({});
  const [progress, setProgress] = useState(0);

  async function refresh() {
    try {
      const state = await request('/api/index');
      setIndexState(state);
      setSettings(current => current ?? state.ragDefaults);
    } catch (nextError) { setError(nextError.message); }
  }
  useEffect(() => {
    refresh();
    request('/api/evaluation/questions').then(data => setQuestions(data.questions)).catch(nextError => setError(nextError.message));
  }, []);

  async function build() {
    setBusy(true); setError('');
    try {
      await request('/api/index/build', { method: 'POST', body: '{}' });
      setComparison(null);
      setEvaluationResults({});
      setRatings({});
      setProgress(0);
      await refresh();
    }
    catch (nextError) { setError(nextError.message); }
    finally { setBusy(false); }
  }

  async function compare(value) {
    return request('/api/compare', { method: 'POST', body: JSON.stringify({ question: value, settings }) });
  }

  async function submit(event) {
    event.preventDefault();
    if (!question.trim()) return;
    setBusy(true); setError(''); setComparison(null);
    try { setComparison(await compare(question)); }
    catch (nextError) { setError(nextError.message); }
    finally { setBusy(false); }
  }

  async function runEvaluation() {
    setEvaluationBusy(true); setError(''); setEvaluationResults({}); setRatings({}); setProgress(0);
    for (let index = 0; index < questions.length; index += 1) {
      const item = questions[index];
      try {
        const result = await compare(item.question);
        setEvaluationResults(current => ({ ...current, [item.id]: result }));
      } catch (nextError) {
        setEvaluationResults(current => ({ ...current, [item.id]: { rawRag: { status: 'error', error: nextError.message }, improvedRag: { status: 'error', error: nextError.message } } }));
      }
      setProgress(index + 1);
    }
    setEvaluationBusy(false);
  }

  function rate(id, mode, value) {
    setRatings(current => ({ ...current, [id]: { ...current[id], [mode]: value } }));
  }

  const scores = useMemo(() => ({
    rawRag: Object.values(ratings).filter(item => item.rawRag).length,
    improvedRag: Object.values(ratings).filter(item => item.improvedRag).length,
  }), [ratings]);
  const completed = Object.keys(evaluationResults).length;
  const ready = indexState?.index.available;
  const invalidSettings = !settings || !Number.isInteger(settings.candidateTopK) || settings.candidateTopK < 1 || settings.candidateTopK > 20 || !Number.isInteger(settings.resultTopK) || settings.resultTopK < 1 || settings.resultTopK > settings.candidateTopK || !Number.isFinite(settings.similarityThreshold) || settings.similarityThreshold < -1 || settings.similarityThreshold > 1;

  return <Container maxWidth="xl" sx={{ py: { xs: 2, md: 5 } }}>
    <Box className="hero">
      <Box><Typography variant="overline" color="primary">AI ADVENT · ДЕНЬ 23</Typography><Typography variant="h2" className="page-title">Реранкинг и фильтрация</Typography><Typography color="text.secondary" mt={1}>Сравниваем обычный retrieval с query rewrite и отсечением нерелевантного контекста.</Typography></Box>
      <Paper variant="outlined" className="index-status">
        <Stack direction="row" gap={1} alignItems="center"><Chip size="small" color={ready ? 'success' : 'warning'} label={ready ? 'индекс готов' : 'нет индекса'} /><Typography fontWeight={750}>Structured index</Typography></Stack>
        <Typography variant="body2" color="text.secondary" mt={1}>{ready ? `${indexState.index.manifest.stats.chunks} чанков · ${indexState.corpus.documents} документа` : 'Постройте индекс перед RAG-запросом.'}</Typography>
        <Button variant="outlined" onClick={build} disabled={busy || evaluationBusy} sx={{ mt: 1.5 }}>{ready ? 'Перестроить индекс' : 'Построить индекс'}</Button>
      </Paper>
    </Box>

    {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
    {invalidSettings && settings && <Alert severity="warning" sx={{ mb: 3 }}>Проверьте настройки: top-K до фильтра — 1–20, top-K после — не больше него, threshold — от −1 до 1.</Alert>}
    <Settings value={settings} onChange={setSettings} disabled={busy || evaluationBusy} />
    <Paper component="form" onSubmit={submit} variant="outlined" className="question-form">
      <TextField fullWidth multiline minRows={2} label="Вопрос к базе знаний" value={question} onChange={event => setQuestion(event.target.value)} inputProps={{ maxLength: 2000 }} />
      <Button type="submit" variant="contained" size="large" disabled={busy || evaluationBusy || !question.trim() || !ready || invalidSettings}>{busy ? <CircularProgress size={24} /> : 'Сравнить режимы'}</Button>
    </Paper>

    <Box className="answer-grid">
      <AnswerCard title={`Raw RAG · top ${settings?.resultTopK ?? '—'}`} result={comparison?.rawRag} />
      <AnswerCard title="Improved RAG · rewrite + filter" result={comparison?.improvedRag} improved />
    </Box>

    <Box className="evaluation-header">
      <Box><Typography variant="overline" color="secondary">КОНТРОЛЬНЫЙ НАБОР</Typography><Typography variant="h4" fontWeight={800}>10 вопросов к базе</Typography><Typography color="text.secondary" mt={0.5}>Сверьте оба RAG-режима с ожиданиями и отметьте качество вручную.</Typography></Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} alignItems={{ sm: 'center' }}>
        <Chip color="primary" label={`Raw: ${scores.rawRag} / ${completed}`} />
        <Chip color="secondary" label={`Improved: ${scores.improvedRag} / ${completed}`} />
        <Button variant="outlined" onClick={runEvaluation} disabled={evaluationBusy || busy || !ready || invalidSettings}>{evaluationBusy ? `Выполняется ${progress}/${questions.length}` : 'Запустить все'}</Button>
      </Stack>
    </Box>
    {evaluationBusy && <LinearProgress variant="determinate" value={(progress / Math.max(questions.length, 1)) * 100} sx={{ mb: 2 }} />}
    <Stack className="evaluation-list">{questions.map(item => <EvaluationItem key={item.id} item={item} result={evaluationResults[item.id]} ratings={ratings[item.id]} onRate={rate} />)}</Stack>
  </Container>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider></React.StrictMode>);
