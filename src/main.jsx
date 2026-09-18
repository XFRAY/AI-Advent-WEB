import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import RuleRoundedIcon from '@mui/icons-material/RuleRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import StyleRoundedIcon from '@mui/icons-material/StyleRounded';
import {
  Alert, Box, Button, CircularProgress, CssBaseline, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, Paper, Stack, TextField,
  ThemeProvider, Tooltip, Typography, createTheme,
} from '@mui/material';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const INK = '#18201f';
const PROFILE_COLORS = ['#12675c', '#8a4f34', '#3d5a9c', '#7a3e73'];
const DEFAULT_SETTINGS = { shortTermLimit: 8 };

const theme = createTheme({
  palette: {
    background: { default: '#edf2ef', paper: '#ffffff' },
    primary: { main: '#12675c' },
    text: { primary: INK, secondary: '#64706c' },
    error: { main: '#b94747' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontSize: '1.35rem', fontWeight: 800, letterSpacing: 0, lineHeight: 1.15 },
    h2: { fontSize: '1rem', fontWeight: 800, letterSpacing: 0, lineHeight: 1.25 },
    body2: { fontSize: '0.92rem', lineHeight: 1.55 },
    caption: { fontSize: '0.78rem', letterSpacing: 0, lineHeight: 1.4 },
  },
  components: {
    MuiButton: { styleOverrides: { root: { borderRadius: 8, fontWeight: 750, minHeight: 42, textTransform: 'none' } } },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 8 } } },
    MuiTextField: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { '& .MuiOutlinedInput-root': { background: '#fff', borderRadius: 8 } } },
    },
  },
});

function App() {
  const [profiles, setProfiles] = useState([]);
  const [modelName, setModelName] = useState('gpt-4o');
  const [question, setQuestion] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [comparisons, setComparisons] = useState([]);
  const [editingProfile, setEditingProfile] = useState(null);
  const [error, setError] = useState('');
  const [isBooting, setIsBooting] = useState(true);
  const [isComparing, setIsComparing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    let mounted = true;

    Promise.all([fetch('/api/profiles'), fetch('/api/config'), fetch('/api/profile-comparisons')])
      .then(async ([profilesResponse, configResponse, comparisonsResponse]) => {
        const profilesData = await profilesResponse.json().catch(() => ({}));
        const configData = await configResponse.json().catch(() => ({}));
        const comparisonsData = await comparisonsResponse.json().catch(() => ({}));
        if (!profilesResponse.ok) throw new Error(profilesData.error || 'Не удалось загрузить профили.');
        if (mounted) {
          setProfiles(profilesData.profiles ?? []);
          setComparisons(comparisonsResponse.ok ? comparisonsData.comparisons ?? [] : []);
          setModelName(configResponse.ok && configData.model ? configData.model : 'gpt-4o');
        }
      })
      .catch((requestError) => mounted && setError(formatRequestError(requestError, 'Не удалось загрузить профили.')))
      .finally(() => mounted && setIsBooting(false));

    return () => { mounted = false; };
  }, []);

  async function handleCompare(event) {
    event.preventDefault();
    const message = question.trim();
    if (!message || isComparing) return;

    setError('');
    setIsComparing(true);
    setPendingQuestion(message);
    setQuestion('');
    try {
      const response = await fetch('/api/profile-comparison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, settings: DEFAULT_SETTINGS }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось получить сравнение.');
      setComparisons((current) => [...current, data.comparison]);
    } catch (requestError) {
      setQuestion(message);
      setError(formatRequestError(requestError, 'Не удалось получить сравнение.'));
    } finally {
      setPendingQuestion('');
      setIsComparing(false);
    }
  }

  async function handleProfileSave(profile) {
    if (!profile?.id || isSaving) return;
    setError('');
    setIsSaving(true);
    try {
      const response = await fetch(`/api/profiles/${encodeURIComponent(profile.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить профиль.');
      setProfiles((current) => current.map((item) => item.id === data.profile.id ? data.profile : item));
      setEditingProfile(null);
    } catch (requestError) {
      setError(formatRequestError(requestError, 'Не удалось сохранить профиль.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClearHistory() {
    if (isClearing) return;
    setError('');
    setIsClearing(true);
    try {
      const response = await fetch('/api/profile-comparisons', { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось очистить историю.');
      setComparisons([]);
    } catch (requestError) {
      setError(formatRequestError(requestError, 'Не удалось очистить историю.'));
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box component="main" sx={{ minHeight: '100vh', p: { xs: 1.25, md: 2 } }}>
        <Box
          sx={{
            display: 'grid',
            gap: 1.5,
            gridTemplateRows: { xs: 'auto', md: 'auto minmax(0, 1fr) auto' },
            height: { xs: 'auto', md: 'calc(100vh - 32px)' },
            maxWidth: 1500,
            minHeight: 0,
            mx: 'auto',
          }}
        >
          <Header
            historyCount={comparisons.length}
            isClearing={isClearing}
            modelName={modelName}
            onClearHistory={handleClearHistory}
            profileCount={profiles.length}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Box
            aria-busy={isBooting}
            sx={{
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns: { xs: '1fr', md: `repeat(${Math.max(profiles.length, 1)}, minmax(0, 1fr))` },
              minHeight: 0,
            }}
          >
            {isBooting
              ? [0, 1].map((index) => <ProfileSkeleton key={index} />)
              : profiles.map((profile, index) => (
                  <ProfilePanel
                    color={PROFILE_COLORS[index % PROFILE_COLORS.length]}
                    comparisons={comparisons}
                    isComparing={isComparing}
                    key={profile.id}
                    onEdit={() => setEditingProfile(profile)}
                    pendingQuestion={pendingQuestion}
                    profile={profile}
                  />
                ))}
          </Box>
          <QuestionComposer
            disabled={isBooting || isComparing || profiles.length === 0}
            isComparing={isComparing}
            onChange={setQuestion}
            onSubmit={handleCompare}
            question={question}
          />
        </Box>
      </Box>
      <ProfileEditor
        isSaving={isSaving}
        onClose={() => setEditingProfile(null)}
        onSave={handleProfileSave}
        open={Boolean(editingProfile)}
        profile={editingProfile}
      />
    </ThemeProvider>
  );
}

function Header({ historyCount, isClearing, modelName, onClearHistory, profileCount }) {
  return (
    <Paper component="header" elevation={0} sx={{ alignItems: 'center', border: '1px solid rgba(24,32,31,0.12)', display: 'flex', justifyContent: 'space-between', gap: 1, p: 1.25 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Box sx={{ bgcolor: INK, borderRadius: 1, color: '#fff', display: 'flex', p: 0.8 }}><AutoAwesomeRoundedIcon fontSize="small" /></Box>
        <Box>
          <Typography component="h1" variant="h1">AI Advent · День 12</Typography>
          <Typography color="text.secondary" variant="caption">Один вопрос, разные профили</Typography>
        </Box>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Stack sx={{ alignItems: 'flex-end' }}>
          <Typography fontWeight={760} variant="caption">{profileCount} профиля · {historyCount} запросов</Typography>
          <Typography color="text.secondary" variant="caption">{modelName}</Typography>
        </Stack>
        <Tooltip title="Очистить всю переписку и память, сохранив профили">
          <span>
            <IconButton aria-label="Очистить всю переписку и память" color="error" disabled={isClearing} onClick={onClearHistory}>
              {isClearing ? <CircularProgress color="inherit" size={18} /> : <DeleteSweepRoundedIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Paper>
  );
}

function ProfilePanel({ color, comparisons, isComparing, onEdit, pendingQuestion, profile }) {
  const history = comparisons
    .map((comparison) => ({
      ...comparison.results.find((result) => result.profile.id === profile.id),
      comparisonId: comparison.id,
      question: comparison.question,
    }))
    .filter((entry) => entry.answer);

  return (
    <Paper component="section" elevation={0} sx={{ border: `1px solid ${withAlpha(color, 0.25)}`, display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr)', height: { md: '100%' }, minHeight: { xs: 560, md: 0 }, overflow: 'hidden' }}>
      <Box sx={{ bgcolor: withAlpha(color, 0.09), borderBottom: `1px solid ${withAlpha(color, 0.18)}`, p: 1.35 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={0.9} sx={{ alignItems: 'center', minWidth: 0 }}>
            <PersonRoundedIcon sx={{ color }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h2" sx={{ color, overflowWrap: 'anywhere' }} variant="h2">{profile.name}</Typography>
              <Typography color="text.secondary" variant="caption">{profile.description}</Typography>
            </Box>
          </Stack>
          <Tooltip title="Редактировать профиль">
            <IconButton aria-label={`Редактировать ${profile.name}`} onClick={onEdit} sx={{ color }}><EditRoundedIcon fontSize="small" /></IconButton>
          </Tooltip>
        </Stack>
      </Box>
      <Box sx={{ borderBottom: '1px solid rgba(24,32,31,0.09)', display: 'grid', gap: 0.75, p: 1.25 }}>
        <ProfileRule color={color} icon={<StyleRoundedIcon />} label="Стиль" value={profile.style} />
        <ProfileRule color={color} icon={<FormatListBulletedRoundedIcon />} label="Формат" value={profile.format} />
        <ProfileRule color={color} icon={<RuleRoundedIcon />} label="Ограничения" value={profile.constraints} />
      </Box>
      <Box sx={{ minHeight: 0, overflowY: 'auto', p: 1.35 }}>
        {history.length > 0 || isComparing ? (
          <ChatHistory
            color={color}
            history={history}
            isComparing={isComparing}
            pendingQuestion={pendingQuestion}
            profileName={profile.name}
          />
        ) : (
          <Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary', height: '100%', justifyContent: 'center', textAlign: 'center' }}>
            <AutoAwesomeRoundedIcon sx={{ color, fontSize: 30 }} />
            <Typography variant="body2">Ответ этого профиля появится здесь.</Typography>
          </Stack>
        )}
      </Box>
    </Paper>
  );
}

function ChatHistory({ color, history, isComparing, pendingQuestion, profileName }) {
  const scrollRef = useRef(null);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [history.length, isComparing]);

  return (
    <Stack ref={scrollRef} spacing={1.2} sx={{ height: '100%', overflowY: 'auto', pr: 0.35 }}>
      {history.map((answer) => (
        <React.Fragment key={`${answer.comparisonId}-${answer.profile.id}`}>
          <Paper
            component="article"
            elevation={0}
            sx={{
              alignSelf: 'flex-end',
              bgcolor: withAlpha(color, 0.1),
              border: `1px solid ${withAlpha(color, 0.2)}`,
              borderRadius: '8px 8px 2px 8px',
              maxWidth: '86%',
              px: 1.1,
              py: 0.85,
            }}
          >
            <Typography color="text.secondary" fontWeight={760} variant="caption">Вы</Typography>
            <Typography sx={{ mt: 0.25, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }} variant="body2">{answer.question}</Typography>
          </Paper>
          <Paper
            component="article"
            elevation={0}
            sx={{
              alignSelf: 'flex-start',
              bgcolor: '#f8faf9',
              border: '1px solid rgba(24,32,31,0.1)',
              borderRadius: '8px 8px 8px 2px',
              maxWidth: '94%',
              px: 1.1,
              py: 0.85,
            }}
          >
            <Typography sx={{ color, fontWeight: 760 }} variant="caption">{profileName}</Typography>
            <Typography sx={{ mt: 0.3, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }} variant="body2">{answer.answer}</Typography>
            <Stack direction="row" sx={{ borderTop: '1px solid rgba(24,32,31,0.08)', flexWrap: 'wrap', gap: 1, mt: 0.8, pt: 0.65 }}>
              <Meta label="Profile" value={`${answer.contextStats.profileCharacters} симв.`} />
              <Meta label="Input" value={`${formatNumber(answer.usage?.inputTokens)} ток.`} />
              <Meta label="Output" value={`${formatNumber(answer.usage?.outputTokens)} ток.`} />
            </Stack>
          </Paper>
        </React.Fragment>
      ))}
      {isComparing && pendingQuestion && (
        <>
          <Paper
            component="article"
            elevation={0}
            sx={{
              alignSelf: 'flex-end',
              bgcolor: withAlpha(color, 0.1),
              border: `1px solid ${withAlpha(color, 0.2)}`,
              borderRadius: '8px 8px 2px 8px',
              maxWidth: '86%',
              px: 1.1,
              py: 0.85,
            }}
          >
            <Typography color="text.secondary" fontWeight={760} variant="caption">Вы</Typography>
            <Typography sx={{ mt: 0.25, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }} variant="body2">{pendingQuestion}</Typography>
          </Paper>
          <Paper
            aria-label={`${profileName} формирует ответ`}
            component="article"
            elevation={0}
            sx={{
              alignSelf: 'flex-start',
              bgcolor: '#f8faf9',
              border: '1px solid rgba(24,32,31,0.1)',
              borderRadius: '8px 8px 8px 2px',
              px: 1.1,
              py: 0.9,
            }}
          >
            <Stack direction="row" spacing={0.8} sx={{ alignItems: 'center' }}>
              <CircularProgress size={15} sx={{ color }} />
              <Typography sx={{ color, fontWeight: 760 }} variant="caption">{profileName} отвечает...</Typography>
            </Stack>
          </Paper>
        </>
      )}
    </Stack>
  );
}

function ProfileRule({ color, icon, label, value }) {
  return (
    <Box sx={{ display: 'grid', gap: 0.75, gridTemplateColumns: '20px 92px minmax(0, 1fr)', alignItems: 'start' }}>
      <Box sx={{ color, display: 'flex', '& svg': { fontSize: 17 } }}>{icon}</Box>
      <Typography color="text.secondary" fontWeight={760} variant="caption">{label}</Typography>
      <Typography sx={{ overflowWrap: 'anywhere' }} variant="caption">{value || '—'}</Typography>
    </Box>
  );
}

function QuestionComposer({ disabled, isComparing, onChange, onSubmit, question }) {
  return (
    <Paper component="form" elevation={0} onSubmit={onSubmit} sx={{ border: '1px solid rgba(24,32,31,0.13)', display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) auto' }, p: 0.9 }}>
      <TextField disabled={disabled} fullWidth maxRows={4} minRows={1} multiline onChange={(event) => onChange(event.target.value)} placeholder="Задайте один вопрос обоим профилям" value={question} />
      <Button disabled={disabled || !question.trim()} endIcon={isComparing ? <CircularProgress color="inherit" size={16} /> : <SendRoundedIcon />} type="submit" variant="contained">
        {isComparing ? 'Сравниваю' : 'Сравнить ответы'}
      </Button>
    </Paper>
  );
}

function ProfileSkeleton() {
  return <Paper elevation={0} sx={{ border: '1px solid rgba(24,32,31,0.1)', minHeight: 560, p: 2 }}><Stack spacing={1} sx={{ alignItems: 'center', height: '100%', justifyContent: 'center' }}><CircularProgress size={28} /><Typography color="text.secondary" variant="body2">Загружаю профиль...</Typography></Stack></Paper>;
}

function ProfileEditor({ isSaving, onClose, onSave, open, profile }) {
  const [draft, setDraft] = useState(profile ?? {});
  useEffect(() => setDraft(profile ?? {}), [profile]);

  return (
    <Dialog fullWidth maxWidth="sm" onClose={isSaving ? undefined : onClose} open={open}>
      <DialogTitle>Настройка профиля</DialogTitle>
      <DialogContent><Stack spacing={1.25} sx={{ pt: 0.5 }}>
        {[
          ['name', 'Название', 1], ['description', 'Описание', 2], ['style', 'Стиль', 2],
          ['format', 'Формат', 2], ['constraints', 'Ограничения', 2],
        ].map(([key, label, rows]) => (
          <TextField key={key} label={label} multiline={rows > 1} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} rows={rows > 1 ? rows : undefined} value={draft[key] ?? ''} />
        ))}
      </Stack></DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button disabled={isSaving} onClick={onClose}>Отмена</Button>
        <Button disabled={isSaving || !(draft.name ?? '').trim()} onClick={() => onSave(draft)} variant="contained">{isSaving ? 'Сохраняю...' : 'Сохранить'}</Button>
      </DialogActions>
    </Dialog>
  );
}

function Meta({ label, value }) {
  return <Typography color="text.secondary" variant="caption">{label}: <Box component="span" sx={{ color: INK, fontWeight: 760 }}>{value}</Box></Typography>;
}

function formatNumber(value) { return new Intl.NumberFormat('ru-RU').format(Number(value) || 0); }
function formatRequestError(error, fallback) {
  if (error instanceof TypeError && error.message === 'Failed to fetch') return 'Не удалось подключиться к локальному API.';
  return error instanceof Error ? error.message : fallback;
}
function withAlpha(hex, alpha) {
  const value = hex.replace('#', '');
  return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${alpha})`;
}

const rootElement = document.getElementById('root');
const appRoot = rootElement.reactRoot ?? createRoot(rootElement);
rootElement.reactRoot = appRoot;
appRoot.render(<App />);
