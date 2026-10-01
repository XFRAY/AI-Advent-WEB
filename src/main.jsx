import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Container, CssBaseline, Divider, FormControl, InputLabel, Link, MenuItem, Paper, Select, Stack, Tab, Tabs, TextField, ThemeProvider, Typography, createTheme } from '@mui/material';
import './styles.css';

const theme = createTheme({ palette: { mode: 'dark', primary: { main: '#ffb25b' }, secondary: { main: '#78dcca' }, background: { default: '#111514', paper: '#19201e' } }, typography: { fontFamily: 'Inter, system-ui, sans-serif', h3: { fontWeight: 800, letterSpacing: '-.04em' } }, shape: { borderRadius: 14 } });
const labels = { fixed: 'Фиксированный размер', structured: 'По структуре' };
const fileUrl = file => `/api/documents/file?path=${encodeURIComponent(file)}`;

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}

function Metric({ label, value, accent }) {
  return <Box className="metric"><Typography variant="caption" color="text.secondary" display="block">{label}</Typography><Typography variant="h5" color={accent ? 'primary' : 'text.primary'} fontWeight={750}>{value ?? '—'}</Typography></Box>;
}

function SourceLink({ file, children }) {
  return <Link href={fileUrl(file)} target="_blank" rel="noopener" underline="hover" sx={{ overflowWrap: 'anywhere' }}>{children ?? file}</Link>;
}

function ChunkCard({ chunk, rank, score }) {
  return <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
      <Stack direction="row" gap={1} alignItems="center">{rank && <Chip size="small" label={`#${rank}`} />}<Typography fontWeight={700}>{chunk.metadata.section}</Typography></Stack>
      <Stack direction="row" gap={1} alignItems="center">{score !== undefined && <Typography color="secondary" fontWeight={700}>{score.toFixed(4)}</Typography>}<Chip size="small" label={`${chunk.metadata.token_count} ток.`} /></Stack>
    </Stack>
    <Typography variant="caption" color="text.secondary" component="div" mt={0.5}><SourceLink file={chunk.metadata.file} /> · {chunk.metadata.chunk_id}</Typography>
    <Typography className="clamped-text" variant="body2" mt={1}>{chunk.text}</Typography>
  </Paper>;
}

function IndexCard({ item, selected }) {
  const stats = item.manifest?.stats;
  return <Card variant="outlined" className={selected ? 'selected-card' : ''} sx={{ minWidth: 0 }}>
    <CardContent>
      <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap"><Typography variant="h6" sx={{ lineHeight: 1.25 }}>{labels[item.strategy]}</Typography><Chip size="small" color={item.available ? 'success' : 'default'} label={item.available ? 'готов' : 'нет индекса'} /></Stack>
      <Typography variant="body2" color="text.secondary" mt={1}>{item.strategy === 'fixed' ? 'Окно 500 токенов · overlap 75' : 'Заголовки, страницы и блоки кода · максимум 700'}</Typography>
      <Box className="metrics-row"><Metric label="Чанков" value={stats?.chunks} /><Metric label="Среднее" value={stats ? `${stats.average_tokens} ток.` : null} /><Metric label="Файл" value={item.bytes ? `${(item.bytes / 1024 / 1024).toFixed(1)} МБ` : null} /></Box>
      {item.available && <Box mt={2}><Button size="small" component="a" href={`/?view=chunks&strategy=${item.strategy}`} target="_blank" rel="noopener">Всё разбиение ↗</Button></Box>}
    </CardContent>
  </Card>;
}

function ChunkViewer({ strategy }) {
  const [data, setData] = useState(null); const [error, setError] = useState('');
  useEffect(() => { request(`/api/indexes/${strategy}/chunks?limit=1000`).then(setData).catch(error => setError(error.message)); }, [strategy]);
  return <Container maxWidth="lg" sx={{ py: { xs: 2, md: 5 } }}>
    <Button component="a" href="/" sx={{ mb: 2 }}>← К индексу</Button>
    <Typography variant="overline" color="primary">ПОЛНОЕ РАЗБИЕНИЕ</Typography><Typography variant="h3" className="page-title">{labels[strategy]}</Typography>
    <Typography color="text.secondary" mb={3}>{data ? `${data.total} чанков. Нажмите на имя файла, чтобы открыть исходный документ.` : 'Загружаю чанки…'}</Typography>
    {error && <Alert severity="error">{error}</Alert>}{!data && !error && <CircularProgress />}
    <Stack gap={1.5}>{data?.chunks.map(chunk => <ChunkCard key={chunk.chunk_id} chunk={chunk} />)}</Stack>
  </Container>;
}

function App() {
  const [state, setState] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [query, setQuery] = useState('Почему индекс нужно записывать атомарно?'); const [topK, setTopK] = useState(5); const [search, setSearch] = useState(null);
  const [selected, setSelected] = useState('fixed'); const [chunks, setChunks] = useState([]);
  async function refresh() { setError(''); try { setState(await request('/api/indexes')); } catch (nextError) { setError(nextError.message); } }
  useEffect(() => { refresh(); }, []);
  async function build() { setBusy(true); setError(''); setSearch(null); try { await request('/api/indexes/build', { method: 'POST', body: JSON.stringify({ strategy: 'all' }) }); await refresh(); } catch (nextError) { setError(nextError.message); } finally { setBusy(false); } }
  async function removeIndexes() { setBusy(true); setError(''); try { await request('/api/indexes', { method: 'DELETE' }); setSearch(null); setChunks([]); await refresh(); } catch (nextError) { setError(nextError.message); } finally { setBusy(false); } }
  async function runSearch(event) { event.preventDefault(); if (!query.trim()) return; setBusy(true); setError(''); try { setSearch(await request('/api/search', { method: 'POST', body: JSON.stringify({ query, strategy: 'all', topK }) })); } catch (nextError) { setError(nextError.message); } finally { setBusy(false); } }
  async function loadChunks(strategy) { setSelected(strategy); setError(''); try { setChunks((await request(`/api/indexes/${strategy}/chunks?limit=20`)).chunks); } catch (nextError) { setChunks([]); setError(nextError.message); } }
  useEffect(() => { if (state?.indexes.some(item => item.strategy === selected && item.available)) loadChunks(selected); }, [state]);
  const corpus = state?.corpus;
  return <Container maxWidth="xl" sx={{ py: { xs: 2, md: 5 } }}>
    <Box className="hero"><Box><Typography variant="overline" color="primary">AI ADVENT · ДЕНЬ 21</Typography><Typography variant="h3" className="page-title">Индекс документов</Typography><Typography color="text.secondary" mt={1}>Два способа разбиения. Один корпус. Сравним, что найдётся.</Typography></Box><Stack className="hero-actions" direction={{ xs: 'column', sm: 'row' }} gap={{ xs: 1.5, sm: 2 }}><Button color="error" variant="outlined" size="large" onClick={removeIndexes} disabled={busy || !state?.indexes.some(item => item.available)}>Удалить индексы</Button><Button variant="contained" size="large" onClick={build} disabled={busy}>{busy ? <CircularProgress size={22} /> : 'Построить оба индекса'}</Button></Stack></Box>
    {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
    {!state ? <CircularProgress /> : <>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, mb: 3 }}><Box className="corpus-metrics"><Metric label="Документы" value={corpus.documents} accent /><Metric label="Токены корпуса" value={corpus.tokens.toLocaleString('ru-RU')} /><Metric label="Эквивалент страниц" value={`~${corpus.estimatedPages}`} /><Metric label="Форматы" value={Object.keys(corpus.types).join(' · ')} /></Box><Box component="details" mt={2}><Typography component="summary" color="primary" sx={{ cursor: 'pointer', fontWeight: 700 }}>Посмотреть файлы корпуса ({corpus.files.length})</Typography><Box className="file-grid">{corpus.files.map(file => <Paper key={file.file} variant="outlined" sx={{ p: 1.5 }}><SourceLink file={file.file}>{file.file} ↗</SourceLink><Typography variant="caption" color="text.secondary" display="block">{file.type} · секций: {file.sections}</Typography></Paper>)}</Box></Box></Paper>
      <Box className="index-grid">{state.indexes.map(item => <IndexCard key={item.strategy} item={item} selected={selected === item.strategy} />)}</Box>
      <Paper component="form" onSubmit={runSearch} variant="outlined" sx={{ p: { xs: 2, md: 3 }, mb: 4 }}><Box className="search-form"><TextField fullWidth label="Вопрос к документам" value={query} onChange={event => setQuery(event.target.value)} inputProps={{ maxLength: 2000 }} /><FormControl fullWidth><InputLabel>Top‑k</InputLabel><Select label="Top‑k" value={topK} onChange={event => setTopK(Number(event.target.value))}>{[3, 5, 10].map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</Select></FormControl><Button type="submit" variant="outlined" disabled={busy || !query.trim()}>Найти</Button></Box></Paper>
      {search && <Box mb={4}><Typography variant="h5" fontWeight={750} mb={2}>Сравнение выдачи</Typography><Box className="result-grid">{['fixed', 'structured'].map(strategy => <Stack key={strategy} gap={1.5}><Typography variant="overline" color={strategy === 'fixed' ? 'primary' : 'secondary'}>{labels[strategy]}</Typography>{search.results[strategy]?.map((result, index) => <ChunkCard key={result.metadata.chunk_id} chunk={result} rank={index + 1} score={result.score} />)}</Stack>)}</Box></Box>}
      <Box><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={1}><Box><Typography variant="h5" fontWeight={750}>Чанки и метаданные</Typography><Typography color="text.secondary">Первые 20 фрагментов. Имя файла открывает оригинал.</Typography></Box><Tabs value={selected} onChange={(_event, value) => loadChunks(value)} variant="scrollable"><Tab value="fixed" label="Fixed" /><Tab value="structured" label="Structured" /></Tabs></Stack><Divider sx={{ my: 2 }} />{chunks.length ? <Stack gap={1.5}>{chunks.map(chunk => <ChunkCard key={chunk.chunk_id} chunk={chunk} />)}</Stack> : <Typography color="text.secondary">Постройте индекс, чтобы увидеть разбиение.</Typography>}</Box>
    </>}
  </Container>;
}

const params = new URLSearchParams(window.location.search);
const viewerStrategy = params.get('view') === 'chunks' && ['fixed', 'structured'].includes(params.get('strategy')) ? params.get('strategy') : null;
createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline />{viewerStrategy ? <ChunkViewer strategy={viewerStrategy} /> : <App />}</ThemeProvider></React.StrictMode>);
