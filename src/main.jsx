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
    <Typography variant="body2" fontWeight={750} mt={1}>{source.source} · {source.section}</Typography>
    <Link href={fileUrl(source.file)} target="_blank" rel="noopener" variant="caption">{source.file} ↗</Link>
    <Typography variant="caption" display="block" color="text.secondary">chunk_id: {source.chunkId}</Typography>
    {candidate && <Typography variant="body2" className="source-text" mt={1}>{source.text}</Typography>}
  </Paper>;
}

function AnswerCard({ result }) {
  if (!result) return <Card variant="outlined" className="answer-card"><CardContent><Typography color="text.secondary">Ответ появится здесь.</Typography></CardContent></Card>;
  return <Card variant="outlined" className={`answer-card ${result.contextFound ? 'grounded-card' : 'unknown-card'}`}>
    <CardContent>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} mb={2}>
        <Typography variant="overline" color={result.contextFound ? 'secondary' : 'warning.main'}>{result.contextFound ? 'ПОДТВЕРЖДЁННЫЙ ОТВЕТ' : 'СЛАБЫЙ КОНТЕКСТ'}</Typography>
        <Chip size="small" color={result.contextFound ? 'success' : 'warning'} label={`${result.durationMs} мс`} />
      </Stack>
      {!result.contextFound && <Alert severity="warning" sx={{ mb: 2 }}>Ни один чанк не преодолел заданный порог релевантности.</Alert>}
      <Typography className="answer-text">{result.answer}</Typography>

      {result.contextFound && <Box className="evidence-grid" mt={3}>
        <Box><Typography variant="overline" color="secondary">ИСТОЧНИКИ · {result.sources.length}</Typography><Stack gap={1} mt={1}>{result.sources.map(source => <SourceCard key={source.chunkId} source={source} />)}</Stack></Box>
        <Box><Typography variant="overline" color="primary">ДОСЛОВНЫЕ ЦИТАТЫ · {result.quotes.length}</Typography><Stack gap={1} mt={1}>{result.quotes.map((quote, index) => <Paper component="blockquote" variant="outlined" className="quote-card" key={`${quote.sourceLabel}-${index}`}><Chip size="small" color="primary" label={quote.sourceLabel} /><Typography mt={1}>«{quote.quote}»</Typography></Paper>)}</Stack></Box>
      </Box>}

      <Paper variant="outlined" className="rewrite-box" sx={{ mt: 3 }}>
        <Typography variant="caption" color="text.secondary">QUERY REWRITE</Typography>
        <Typography>{result.retrieval.rewrittenQuery}</Typography>
        <Stack direction="row" gap={1} mt={1} flexWrap="wrap">
          <Chip size="small" label={`кандидатов: ${result.retrieval.filtering.candidateCount}`} />
          <Chip size="small" label={`прошли порог: ${result.retrieval.filtering.thresholdPassedCount}`} />
          <Chip size="small" color="secondary" label={`в контексте: ${result.retrieval.filtering.retainedCount}`} />
        </Stack>
      </Paper>
      {result.retrieval.candidates.length > 0 && <Box component="details" mt={2}>
        <Typography component="summary" color="text.secondary" fontWeight={750} sx={{ cursor: 'pointer' }}>Диагностика кандидатов ({result.retrieval.candidates.length})</Typography>
        <Stack gap={1} mt={1.5}>{result.retrieval.candidates.map(source => <SourceCard key={source.chunkId} source={source} candidate />)}</Stack>
      </Box>}
    </CardContent>
  </Card>;
}

function Check({ passed, label }) {
  return <Chip size="small" color={passed ? 'success' : 'error'} label={`${passed ? '✓' : '✕'} ${label}`} />;
}

function EvaluationItem({ item, result, semanticMatch, onRate }) {
  const hasSources = Boolean(result?.contextFound && result.sources?.length);
  const hasQuotes = Boolean(result?.contextFound && result.quotes?.length);
  return <Paper component="details" variant="outlined" className="evaluation-item">
    <Box component="summary" className="evaluation-summary">
      <Chip size="small" label={item.id} />
      <Typography fontWeight={750}>{item.question}</Typography>
      <Chip size="small" color={result ? (hasSources && hasQuotes ? 'success' : 'warning') : 'default'} label={result ? 'готово' : 'не запускался'} />
    </Box>
    <Box className="evaluation-body">
      <Typography variant="caption" color="text.secondary">ОЖИДАНИЕ</Typography>
      <Typography mb={1}>{item.expectation}</Typography>
      <Typography variant="caption" color="text.secondary">ЦЕЛЕВЫЕ ИСТОЧНИКИ</Typography>
      <Stack gap={0.4} mt={0.5} mb={2}>{item.sources.map(source => <Typography variant="body2" key={source}>• {source}</Typography>)}</Stack>
      {result && <>
        <Typography className="mini-answer">{result.answer}</Typography>
        <Stack direction="row" gap={1} flexWrap="wrap" mt={1.5} alignItems="center">
          <Check passed={hasSources} label="есть источники" />
          <Check passed={hasQuotes} label="есть цитаты" />
          <FormControlLabel control={<Checkbox checked={Boolean(semanticMatch)} onChange={event => onRate(item.id, event.target.checked)} />} label="Смысл ответа совпадает с цитатами" />
        </Stack>
      </>}
    </Box>
  </Paper>;
}

function Settings({ value, onChange, disabled }) {
  if (!value) return null;
  const field = key => event => onChange({ ...value, [key]: Number(event.target.value) });
  return <Paper variant="outlined" className="settings-panel">
    <Box><Typography variant="overline" color="secondary">НАСТРОЙКИ RETRIEVAL</Typography><Typography variant="body2" color="text.secondary">Порог управляет режимом «не знаю».</Typography></Box>
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
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [evaluationBusy, setEvaluationBusy] = useState(false);
  const [evaluationResults, setEvaluationResults] = useState({});
  const [semanticRatings, setSemanticRatings] = useState({});
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
      setAnswer(null); setEvaluationResults({}); setSemanticRatings({}); setProgress(0);
      await refresh();
    } catch (nextError) { setError(nextError.message); }
    finally { setBusy(false); }
  }

  const ask = value => request('/api/answer', { method: 'POST', body: JSON.stringify({ question: value, settings }) });

  async function submit(event) {
    event.preventDefault();
    if (!question.trim()) return;
    setBusy(true); setError(''); setAnswer(null);
    try { setAnswer(await ask(question)); }
    catch (nextError) { setError(nextError.message); }
    finally { setBusy(false); }
  }

  async function runEvaluation() {
    setEvaluationBusy(true); setError(''); setEvaluationResults({}); setSemanticRatings({}); setProgress(0);
    for (let index = 0; index < questions.length; index += 1) {
      const item = questions[index];
      try {
        const result = await ask(item.question);
        setEvaluationResults(current => ({ ...current, [item.id]: result }));
      }
      catch (nextError) { setEvaluationResults(current => ({ ...current, [item.id]: { contextFound: false, answer: `Ошибка: ${nextError.message}`, sources: [], quotes: [] } })); }
      setProgress(index + 1);
    }
    setEvaluationBusy(false);
  }

  const results = Object.values(evaluationResults);
  const scores = useMemo(() => ({
    sources: results.filter(item => item.contextFound && item.sources?.length).length,
    quotes: results.filter(item => item.contextFound && item.quotes?.length).length,
    semantics: Object.values(semanticRatings).filter(Boolean).length,
  }), [evaluationResults, semanticRatings]);
  const completed = results.length;
  const ready = indexState?.index.available;
  const invalidSettings = !settings || !Number.isInteger(settings.candidateTopK) || settings.candidateTopK < 1 || settings.candidateTopK > 20 || !Number.isInteger(settings.resultTopK) || settings.resultTopK < 1 || settings.resultTopK > settings.candidateTopK || !Number.isFinite(settings.similarityThreshold) || settings.similarityThreshold < -1 || settings.similarityThreshold > 1;

  return <Container maxWidth="lg" sx={{ py: { xs: 2, md: 5 } }}>
    <Box className="hero">
      <Box><Typography variant="overline" color="primary">AI ADVENT · ДЕНЬ 24</Typography><Typography variant="h2" className="page-title">Цитаты и анти-галлюцинации</Typography><Typography color="text.secondary" mt={1}>Каждый ответ проходит проверку источников и дословных цитат. Слабый контекст включает честный режим «не знаю».</Typography></Box>
      <Paper variant="outlined" className="index-status">
        <Stack direction="row" gap={1} alignItems="center"><Chip size="small" color={ready ? 'success' : 'warning'} label={ready ? 'индекс готов' : 'нет индекса'} /><Typography fontWeight={750}>Grounded RAG</Typography></Stack>
        <Typography variant="body2" color="text.secondary" mt={1}>{ready ? `${indexState.index.manifest.stats.chunks} чанков · ${indexState.corpus.documents} документа` : 'Постройте индекс перед RAG-запросом.'}</Typography>
        <Button variant="outlined" onClick={build} disabled={busy || evaluationBusy} sx={{ mt: 1.5 }}>{ready ? 'Перестроить индекс' : 'Построить индекс'}</Button>
      </Paper>
    </Box>
    {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
    {invalidSettings && settings && <Alert severity="warning" sx={{ mb: 3 }}>Проверьте настройки: top-K до фильтра — 1–20, top-K после — не больше него, threshold — от −1 до 1.</Alert>}
    <Settings value={settings} onChange={setSettings} disabled={busy || evaluationBusy} />
    <Paper component="form" onSubmit={submit} variant="outlined" className="question-form">
      <TextField fullWidth multiline minRows={2} label="Вопрос к базе знаний" value={question} onChange={event => setQuestion(event.target.value)} inputProps={{ maxLength: 2000 }} />
      <Button type="submit" variant="contained" size="large" disabled={busy || evaluationBusy || !question.trim() || !ready || invalidSettings}>{busy ? <CircularProgress size={24} /> : 'Получить ответ'}</Button>
    </Paper>
    <AnswerCard result={answer} />

    <Box className="evaluation-header">
      <Box><Typography variant="overline" color="secondary">КОНТРОЛЬНЫЙ НАБОР</Typography><Typography variant="h4" fontWeight={800}>10 вопросов к базе</Typography><Typography color="text.secondary" mt={0.5}>Источники и цитаты проверяются автоматически; смысл — вручную.</Typography></Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'center' }} flexWrap="wrap">
        <Chip color="success" label={`Источники: ${scores.sources} / ${completed}`} />
        <Chip color="primary" label={`Цитаты: ${scores.quotes} / ${completed}`} />
        <Chip color="secondary" label={`Смысл: ${scores.semantics} / ${completed}`} />
        <Button variant="outlined" onClick={runEvaluation} disabled={evaluationBusy || busy || !ready || invalidSettings}>{evaluationBusy ? `Выполняется ${progress}/${questions.length}` : 'Запустить все'}</Button>
      </Stack>
    </Box>
    {evaluationBusy && <LinearProgress variant="determinate" value={(progress / Math.max(questions.length, 1)) * 100} sx={{ mb: 2 }} />}
    <Stack className="evaluation-list">{questions.map(item => <EvaluationItem key={item.id} item={item} result={evaluationResults[item.id]} semanticMatch={semanticRatings[item.id]} onRate={(id, value) => setSemanticRatings(current => ({ ...current, [id]: value }))} />)}</Stack>
  </Container>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider></React.StrictMode>);
