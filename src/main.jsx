import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded';
import BookmarkAddRoundedIcon from '@mui/icons-material/BookmarkAddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded';
import MemoryRoundedIcon from '@mui/icons-material/MemoryRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  CssBaseline,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
  createTheme,
} from '@mui/material';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const DEFAULT_MODEL_CONTEXT_LIMIT = 128_000;
const DEFAULT_SETTINGS = {
  lastMessagesCount: 6,
};
const STRATEGY_ACCENTS = {
  sliding: '#0f6b5f',
  facts: '#8a5a00',
  branching: '#3559a6',
};
const INK = '#17201e';
const FACT_LABELS = {
  goal: 'Цель',
  constraints: 'Ограничения',
  preferences: 'Предпочтения',
  decisions: 'Решения',
  openQuestions: 'Открытые вопросы',
  agreements: 'Договоренности',
};
const welcomeMessages = {
  sliding: {
    id: 'welcome-sliding',
    role: 'agent',
    text: 'Я вижу только последние N сообщений. Ранние детали исчезают физически.',
  },
  facts: {
    id: 'welcome-facts',
    role: 'agent',
    text: 'Я вижу facts-блок и последние N сообщений. Договоренности живут отдельно.',
  },
  branching: {
    id: 'welcome-branching',
    role: 'agent',
    text: 'Я веду активную ветку. Сделайте checkpoint, чтобы разойтись в A/B.',
  },
};

const theme = createTheme({
  palette: {
    background: {
      default: '#eef3f1',
      paper: '#ffffff',
    },
    primary: {
      main: STRATEGY_ACCENTS.sliding,
    },
    text: {
      primary: INK,
      secondary: '#65716d',
    },
    error: {
      main: '#b94747',
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 16,
    h1: {
      fontSize: 'clamp(1.35rem, 2vw, 2.05rem)',
      fontWeight: 780,
      letterSpacing: 0,
      lineHeight: 1.08,
    },
    h2: {
      fontSize: '0.98rem',
      fontWeight: 780,
      letterSpacing: 0,
      lineHeight: 1.2,
    },
    body2: {
      fontSize: '0.92rem',
      lineHeight: 1.5,
    },
    caption: {
      fontSize: '0.79rem',
      letterSpacing: 0,
      lineHeight: 1.35,
    },
  },
  components: {
    MuiButton: {
      defaultProps: {
        size: 'small',
      },
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 740,
          minHeight: 40,
          textTransform: 'none',
          whiteSpace: 'nowrap',
        },
      },
    },
    MuiIconButton: {
      defaultProps: {
        size: 'small',
      },
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: 'small',
      },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            background: '#ffffff',
            borderRadius: 10,
            fontSize: '0.96rem',
            lineHeight: 1.5,
          },
        },
      },
    },
  },
});

function App() {
  const [messages, setMessages] = useState({
    sliding: [welcomeMessages.sliding],
    facts: [welcomeMessages.facts],
    branching: [welcomeMessages.branching],
  });
  const [facts, setFacts] = useState({});
  const [branchingState, setBranchingState] = useState({
    activeBranchId: 'main',
    checkpointAt: null,
    checkpointMessageCount: 0,
    branchLabels: {
      main: 'Main',
      A: 'Branch A',
      B: 'Branch B',
    },
  });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [modelName, setModelName] = useState('gpt-4o-mini');
  const [modelContextLimit, setModelContextLimit] = useState(DEFAULT_MODEL_CONTEXT_LIMIT);
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [isBooting, setIsBooting] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const inputRef = useRef(null);
  const hasSavedMessages = Object.entries(messages).some(([strategy, strategyMessages]) =>
    hasRealMessages(strategyMessages, welcomeMessages[strategy].id),
  );
  const isOverflow = Object.values(preview ?? {}).some(
    (item) => item?.tokenReport?.context?.status === 'overflow',
  );
  const canSend =
    input.trim().length > 0 &&
    !isLoading &&
    !isBooting &&
    !isResetting &&
    !isOverflow;

  useEffect(() => {
    let isMounted = true;

    async function loadInitialData() {
      try {
        const [messagesResponse, configResponse] = await Promise.all([
          fetch('/api/messages'),
          fetch('/api/config'),
        ]);
        const messagesData = await messagesResponse.json().catch(() => ({}));
        const configData = await configResponse.json().catch(() => ({}));

        if (!messagesResponse.ok) {
          throw new Error(messagesData.error || 'Не удалось загрузить истории.');
        }

        if (!isMounted) {
          return;
        }

        setMessages({
          sliding: withWelcome(messagesData.slidingMessages, welcomeMessages.sliding),
          facts: withWelcome(messagesData.factsMessages, welcomeMessages.facts),
          branching: withWelcome(messagesData.branchingMessages, welcomeMessages.branching),
        });
        setFacts(messagesData.facts ?? {});
        setBranchingState(messagesData.branchingState ?? branchingState);
        setModelName(configResponse.ok && configData.model ? configData.model : 'gpt-4o-mini');
        setModelContextLimit(
          configResponse.ok && Number.isInteger(configData.modelContextWindow)
            ? configData.modelContextWindow
            : DEFAULT_MODEL_CONTEXT_LIMIT,
        );
        if (configResponse.ok && configData.strategyDefaults) {
          setSettings(configData.strategyDefaults);
        }
      } catch (requestError) {
        setError(formatRequestError(requestError, 'Не удалось загрузить истории.'));
      } finally {
        if (isMounted) {
          setIsBooting(false);
        }
      }
    }

    loadInitialData();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (isBooting || isResetting) {
      setPreview(null);
      return undefined;
    }

    const controller = new AbortController();
    const message = input.trim();

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/context-preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message, settings }),
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || 'Не удалось посчитать токены.');
        }

        setPreview(data);
      } catch (requestError) {
        if (requestError?.name !== 'AbortError') {
          setPreview(null);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [
    input,
    isBooting,
    isResetting,
    messages.sliding.length,
    messages.facts.length,
    messages.branching.length,
    settings.lastMessagesCount,
    branchingState.activeBranchId,
  ]);

  async function handleSubmit(event) {
    event.preventDefault();

    const text = input.trim();
    if (!text || !canSend) {
      return;
    }

    setError('');
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat/compare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: text, settings }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Не удалось получить ответы стратегий.');
      }

      setMessages({
        sliding: withWelcome(data.sliding?.messages, welcomeMessages.sliding),
        facts: withWelcome(data.facts?.messages, welcomeMessages.facts),
        branching: withWelcome(data.branching?.messages, welcomeMessages.branching),
      });
      setFacts(data.facts?.facts ?? facts);
      setBranchingState(data.branching?.branchingState ?? branchingState);
      setPreview(null);
    } catch (requestError) {
      setError(formatRequestError(requestError, 'Произошла неизвестная ошибка.'));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  async function handleReset() {
    if (isLoading || isBooting || isResetting || !hasSavedMessages) {
      return;
    }

    setError('');
    setIsResetting(true);

    try {
      const response = await fetch('/api/messages', {
        method: 'DELETE',
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Не удалось очистить истории.');
      }

      setMessages({
        sliding: [welcomeMessages.sliding],
        facts: [welcomeMessages.facts],
        branching: [welcomeMessages.branching],
      });
      setFacts(data.facts ?? {});
      setBranchingState(data.branchingState ?? branchingState);
      setPreview(null);
    } catch (requestError) {
      setError(formatRequestError(requestError, 'Не удалось очистить истории.'));
    } finally {
      setIsResetting(false);
      inputRef.current?.focus();
    }
  }

  async function handleCheckpoint() {
    if (isLoading || isBooting || isResetting) {
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/branching/checkpoint', {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Не удалось создать checkpoint.');
      }

      setBranchingState(data.branchingState ?? branchingState);
      setMessages((current) => ({
        ...current,
        branching: withWelcome(data.branchingMessages, welcomeMessages.branching),
      }));
    } catch (requestError) {
      setError(formatRequestError(requestError, 'Не удалось создать checkpoint.'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSwitchBranch(branchId) {
    if (isLoading || isBooting || isResetting || branchId === branchingState.activeBranchId) {
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/branching/active-branch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ branchId }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Не удалось переключить ветку.');
      }

      setBranchingState(data.branchingState ?? branchingState);
      setMessages((current) => ({
        ...current,
        branching: withWelcome(data.branchingMessages, welcomeMessages.branching),
      }));
    } catch (requestError) {
      setError(formatRequestError(requestError, 'Не удалось переключить ветку.'));
    } finally {
      setIsLoading(false);
    }
  }

  function updateSettings(key, value) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        component="main"
        sx={{
          background:
            'linear-gradient(118deg, rgba(15, 107, 95, 0.15) 0%, rgba(238, 243, 241, 0.96) 38%, rgba(138, 90, 0, 0.12) 70%, rgba(53, 89, 166, 0.13) 100%), #eef3f1',
          minHeight: '100vh',
          p: { xs: 1, md: 2 },
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gap: 1.25,
            gridTemplateRows: 'auto minmax(0, 1fr) auto',
            height: { xs: 'auto', xl: 'calc(100vh - 32px)' },
            maxWidth: 1760,
            minHeight: { xs: '100vh', xl: 0 },
            mx: 'auto',
          }}
        >
          <Paper
            component="header"
            elevation={0}
            sx={{
              background: 'rgba(255, 255, 255, 0.96)',
              border: '1px solid rgba(24, 32, 31, 0.12)',
              borderRadius: 2,
              display: 'flex',
              gap: 1,
              p: { xs: 1, md: 1 },
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Box
                sx={{
                  alignItems: 'center',
                  background: INK,
                  borderRadius: 1.2,
                  color: '#fff8ef',
                  display: 'inline-flex',
                  fontSize: '0.84rem',
                  fontWeight: 780,
                  gap: 0.7,
                  lineHeight: 1,
                  px: 1,
                  py: 0.75,
                }}
              >
                <MemoryRoundedIcon sx={{ fontSize: 18 }} />
                AI Advent · День 10
              </Box>
              <Typography color="text.secondary" variant="caption">
                {modelName} · окно {formatNumber(modelContextLimit)} ток.
              </Typography>
              <SharedWindowControl
                disabled={isLoading || isBooting || isResetting}
                onChange={updateSettings}
                settings={settings}
              />
            </Stack>
          </Paper>

          <Box
            sx={{
              display: 'grid',
              gap: 1.25,
              gridTemplateColumns: { xs: '1fr', xl: 'repeat(3, minmax(0, 1fr))' },
              minHeight: 0,
            }}
          >
            <StrategyPanel
              accent={STRATEGY_ACCENTS.sliding}
              icon={<TuneRoundedIcon />}
              isBooting={isBooting}
              isLoading={isLoading}
              messages={messages.sliding}
              previewReport={preview?.sliding?.tokenReport}
              stats={preview?.sliding?.stats}
              subtitle={`Хранит только последние ${settings.lastMessagesCount} сообщений`}
              title="Sliding Window"
              welcomeId={welcomeMessages.sliding.id}
            />
            <StrategyPanel
              accent={STRATEGY_ACCENTS.facts}
              extraHeader={<FactsBlock facts={facts} />}
              icon={<FactCheckRoundedIcon />}
              isBooting={isBooting}
              isLoading={isLoading}
              messages={messages.facts}
              previewReport={preview?.facts?.tokenReport}
              stats={preview?.facts?.stats}
              subtitle={`Facts + последние ${settings.lastMessagesCount} сообщений`}
              title="Sticky Facts"
              welcomeId={welcomeMessages.facts.id}
            />
            <StrategyPanel
              accent={STRATEGY_ACCENTS.branching}
              extraHeader={
                <BranchControls
                  branchingState={branchingState}
                  disabled={isLoading || isBooting || isResetting}
                  onCheckpoint={handleCheckpoint}
                  onSwitchBranch={handleSwitchBranch}
                />
              }
              icon={<AccountTreeRoundedIcon />}
              isBooting={isBooting}
              isLoading={isLoading}
              messages={messages.branching}
              previewReport={preview?.branching?.tokenReport}
              stats={preview?.branching?.stats}
              subtitle={`Активная ветка: ${branchingState.activeBranchId}`}
              title="Branching"
              welcomeId={welcomeMessages.branching.id}
            />
          </Box>

          <Paper
            component="form"
            elevation={0}
            onSubmit={handleSubmit}
            sx={{
              background: 'rgba(255, 255, 255, 0.96)',
              border: '1px solid rgba(24, 32, 31, 0.12)',
              borderRadius: 2,
              display: 'grid',
              gap: 0.65,
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) auto' },
              p: { xs: 0.65, md: 0.75 },
            }}
          >
            <Stack spacing={0.65}>
              {error && (
                <Alert severity="error" sx={{ borderRadius: 1.5 }}>
                  {error}
                </Alert>
              )}
              {isOverflow && !error && (
                <Alert severity="warning" sx={{ borderRadius: 1.5 }}>
                  Следующий запрос превышает лимит контекста в одной из стратегий.
                </Alert>
              )}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  disabled={isLoading || isBooting || isResetting}
                  fullWidth
                  inputRef={inputRef}
                  maxRows={3}
                  minRows={1}
                  multiline
                  onChange={(event) => {
                    setInput(event.target.value);
                    setError('');
                  }}
                  placeholder="Один запрос уйдет в Sliding, Facts и активную Branching-ветку"
                  sx={{
                    '& .MuiOutlinedInput-input': {
                      py: 0.65,
                    },
                  }}
                  value={input}
                />
                <Button
                  disabled={!canSend}
                  endIcon={isLoading ? <CircularProgress color="inherit" size={16} /> : <SendRoundedIcon />}
                  sx={{
                    alignSelf: 'stretch',
                    background: STRATEGY_ACCENTS.sliding,
                    minHeight: { xs: 40, sm: 42 },
                    minWidth: { xs: '100%', sm: 150 },
                    '&:hover': {
                      background: '#0b5b51',
                    },
                  }}
                  type="submit"
                  variant="contained"
                >
                  {isLoading ? 'Жду ответы' : 'Отправить'}
                </Button>
              </Stack>
            </Stack>

            <Box sx={{ alignSelf: 'end', justifySelf: { xs: 'start', lg: 'end' } }}>
              <Tooltip title="Очистить все стратегии, facts и ветки">
                <span>
                  <IconButton
                    aria-label="Очистить истории"
                    color="error"
                    disabled={isLoading || isBooting || isResetting || !hasSavedMessages}
                    onClick={handleReset}
                    sx={{
                      background: 'rgba(185, 71, 71, 0.08)',
                      border: '1px solid rgba(185, 71, 71, 0.18)',
                      height: 36,
                      width: 36,
                    }}
                  >
                    <DeleteOutlineRoundedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Paper>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

function StrategyPanel({
  accent,
  extraHeader = null,
  icon,
  isBooting,
  isLoading,
  messages,
  previewReport,
  stats,
  subtitle,
  title,
  welcomeId,
}) {
  const scrollRef = useRef(null);
  const latestUsage = useMemo(() => findLatestUsage(messages), [messages]);
  const realMessages = removeWelcome(messages, welcomeId);

  useLayoutEffect(() => {
    const node = scrollRef.current;

    if (!node) {
      return;
    }

    node.scrollTo({
      top: node.scrollHeight,
      behavior: isBooting ? 'auto' : 'smooth',
    });
  }, [isBooting, isLoading, messages]);

  return (
    <Paper
      component="section"
      elevation={0}
      sx={{
        background: '#ffffff',
        border: '1px solid rgba(24, 32, 31, 0.13)',
        borderRadius: 2,
        boxShadow: '0 20px 56px rgba(24, 32, 31, 0.1)',
        display: 'grid',
        gridTemplateRows: 'auto auto minmax(0, 1fr)',
        minHeight: { xs: 560, xl: 0 },
        overflow: 'hidden',
      }}
    >
      <Box
        component="header"
        sx={{
          background: `linear-gradient(135deg, ${withAlpha(accent, 0.14)} 0%, rgba(255,255,255,0.9) 72%)`,
          borderBottom: '1px solid rgba(24, 32, 31, 0.1)',
          display: 'grid',
          gap: 0.8,
          p: { xs: 1.1, md: 1.25 },
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Stack spacing={0.2} sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={0.7} sx={{ alignItems: 'center' }}>
              <Box sx={{ color: accent, display: 'inline-flex' }}>{icon}</Box>
              <Typography component="h2" sx={{ color: accent }} variant="h2">
                {title}
              </Typography>
            </Stack>
            <Typography color="text.secondary" variant="caption">
              {subtitle}
            </Typography>
          </Stack>
          <Box
            sx={{
              background: accent,
              borderRadius: 1,
              height: 12,
              width: 12,
            }}
          />
        </Stack>
        {extraHeader}
        <ContextMeter accent={accent} latestUsage={latestUsage} previewReport={previewReport} />
      </Box>

      {stats && (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            background: withAlpha(accent, 0.08),
            borderBottom: '1px solid rgba(24, 32, 31, 0.08)',
            flexWrap: 'wrap',
            gap: 0.8,
            px: 1.25,
            py: 0.8,
          }}
        >
          <TinyStat label="В запросе" value={formatNumber(stats.sentMessageCount)} />
          <TinyStat label="Отброшено" value={formatNumber(stats.droppedMessageCount)} />
          {stats.factsCharacters > 0 && (
            <TinyStat label="Facts" value={`${formatNumber(stats.factsCharacters)} симв.`} />
          )}
        </Stack>
      )}

      <Box
        aria-live="polite"
        ref={scrollRef}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          minHeight: 0,
          overflowY: 'auto',
          p: { xs: 1, md: 1.25 },
        }}
      >
        {messages.map((message, index) => (
          <MessageBubble
            accent={accent}
            key={message.id}
            message={message}
            requestTokens={findRequestTokensForMessage(messages, index)}
          />
        ))}
        {isLoading && (
          <MessageBubble
            accent={accent}
            isLoading
            message={{
              id: `${title}-loading`,
              role: 'agent',
              text: 'Думаю...',
            }}
          />
        )}
        {isBooting && (
          <MessageBubble
            accent={accent}
            isLoading
            message={{
              id: `${title}-booting`,
              role: 'agent',
              text: 'Загружаю историю...',
            }}
          />
        )}
        {realMessages.length === 0 && !isBooting && (
          <Typography color="text.secondary" sx={{ px: 0.5 }} variant="caption">
            Начните диалог, чтобы увидеть поведение стратегии.
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

function SharedWindowControl({ disabled, onChange, settings }) {
  return (
    <Box
      sx={{
        alignItems: 'center',
        border: '1px solid rgba(24, 32, 31, 0.1)',
        borderRadius: 1.5,
        display: 'grid',
        gap: 0.7,
        gridTemplateColumns: { xs: '1fr', sm: 'auto 78px' },
        minWidth: { xs: '100%', sm: 270 },
        p: 0.65,
      }}
    >
      <Stack direction="row" spacing={0.7} sx={{ alignItems: 'center' }}>
        <TuneRoundedIcon sx={{ color: STRATEGY_ACCENTS.sliding, fontSize: 18 }} />
        <Typography color="text.secondary" fontWeight={780} variant="caption">
          Окно Sliding + Facts
        </Typography>
      </Stack>
      <TextField
        disabled={disabled}
        fullWidth
        inputProps={{ 'aria-label': 'Окно Sliding + Facts', max: 30, min: 2, step: 1 }}
        onChange={(event) => onChange('lastMessagesCount', Number(event.target.value))}
        sx={{
          '& .MuiOutlinedInput-input': {
            py: 0.65,
          },
        }}
        type="number"
        value={settings.lastMessagesCount}
      />
    </Box>
  );
}

function FactsBlock({ facts }) {
  return (
    <Box
      sx={{
        background: 'rgba(255,255,255,0.72)',
        border: '1px solid rgba(24, 32, 31, 0.1)',
        borderRadius: 1.5,
        display: 'grid',
        gap: 0.45,
        maxHeight: 154,
        overflowY: 'auto',
        p: 0.9,
      }}
    >
      {Object.entries(FACT_LABELS).map(([key, label]) => (
        <Typography key={key} sx={{ overflowWrap: 'anywhere' }} variant="caption">
          <Box component="span" sx={{ color: STRATEGY_ACCENTS.facts, fontWeight: 780 }}>
            {label}:
          </Box>{' '}
          {facts?.[key] || '—'}
        </Typography>
      ))}
    </Box>
  );
}

function BranchControls({ branchingState, disabled, onCheckpoint, onSwitchBranch }) {
  const hasCheckpoint = Boolean(branchingState.checkpointAt);

  return (
    <Box
      sx={{
        background: 'rgba(255,255,255,0.72)',
        border: '1px solid rgba(24, 32, 31, 0.1)',
        borderRadius: 1.5,
        display: 'grid',
        gap: 0.8,
        p: 0.9,
      }}
    >
      <Stack direction="row" spacing={0.8} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          disabled={disabled}
          onClick={onCheckpoint}
          startIcon={<BookmarkAddRoundedIcon />}
          variant="outlined"
        >
          Checkpoint
        </Button>
        <Button
          disabled={disabled || !hasCheckpoint || branchingState.activeBranchId === 'A'}
          onClick={() => onSwitchBranch('A')}
          startIcon={<SwapHorizRoundedIcon />}
          variant={branchingState.activeBranchId === 'A' ? 'contained' : 'outlined'}
        >
          A
        </Button>
        <Button
          disabled={disabled || !hasCheckpoint || branchingState.activeBranchId === 'B'}
          onClick={() => onSwitchBranch('B')}
          startIcon={<SwapHorizRoundedIcon />}
          variant={branchingState.activeBranchId === 'B' ? 'contained' : 'outlined'}
        >
          B
        </Button>
      </Stack>
      <Typography color="text.secondary" variant="caption">
        {hasCheckpoint
          ? `Checkpoint: ${branchingState.checkpointMessageCount} сообщ., ${formatDateTime(branchingState.checkpointAt)}`
          : 'Checkpoint еще не создан.'}
      </Typography>
    </Box>
  );
}

function ContextMeter({ accent, latestUsage, previewReport }) {
  const report = previewReport ?? latestUsage?.tokenReport;
  const usedTokens = report?.context?.inputTokens ?? report?.fullInputTokens ?? 0;
  const limit = report?.context?.contextWindow ?? DEFAULT_MODEL_CONTEXT_LIMIT;
  const percent = limit > 0 ? Math.min((usedTokens / limit) * 100, 100) : 0;

  return (
    <Stack spacing={0.6}>
      <LinearProgress
        sx={{
          bgcolor: 'rgba(24, 32, 31, 0.08)',
          borderRadius: 1,
          height: 7,
          '& .MuiLinearProgress-bar': {
            background: accent,
            borderRadius: 1,
          },
        }}
        value={percent}
        variant="determinate"
      />
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
        <Typography color="text.secondary" variant="caption">
          input: {formatNumber(usedTokens)} ток.
        </Typography>
        <Typography color="text.secondary" variant="caption">
          история: {formatNumber(report?.conversationHistoryTokens)} ток.
        </Typography>
      </Stack>
    </Stack>
  );
}

function MessageBubble({ accent, message, isLoading = false, requestTokens = null }) {
  const isUser = message.role === 'user';

  return (
    <Paper
      component="article"
      elevation={0}
      sx={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        background: isUser
          ? `linear-gradient(135deg, ${withAlpha(accent, 0.16)} 0%, rgba(255,255,255,0.92) 100%)`
          : 'linear-gradient(180deg, #ffffff 0%, #f7faf8 100%)',
        border: '1px solid rgba(24, 32, 31, 0.1)',
        borderRadius: 2,
        boxShadow: isUser ? `0 14px 30px ${withAlpha(accent, 0.09)}` : '0 14px 30px rgba(24, 32, 31, 0.07)',
        maxWidth: { xs: '100%', md: '88%' },
        px: 1,
        py: 0.9,
      }}
    >
      <Stack spacing={0.55}>
        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
          <Box aria-hidden="true" sx={{ background: accent, borderRadius: 1, height: 8, width: 8 }} />
          <Typography color="text.secondary" fontWeight={760} variant="caption">
            {isUser ? 'Вы' : 'Агент'}
          </Typography>
          {isLoading && <CircularProgress color="inherit" size={10} />}
        </Stack>
        <Typography sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }} variant="body2">
          {message.text}
        </Typography>
        {isUser && typeof requestTokens === 'number' && (
          <MessageMetaLine items={[`сообщение: ${formatNumber(requestTokens)} ток.`]} />
        )}
        {!isUser && message.metadata && <MessageStats metadata={message.metadata} />}
      </Stack>
    </Paper>
  );
}

function MessageStats({ metadata }) {
  const { model, usage } = metadata;
  const items = [
    metadata.strategy || 'strategy',
    model || 'unknown',
    `input: ${formatNumber(usage?.inputTokens)} ток.`,
    `output: ${formatNumber(usage?.outputTokens)} ток.`,
    formatCost(usage?.cost),
  ];

  if (metadata.branchId) {
    items.push(`branch: ${metadata.branchId}`);
  }

  return <MessageMetaLine items={items} />;
}

function MessageMetaLine({ items }) {
  return (
    <Stack
      direction="row"
      spacing={0.6}
      sx={{
        borderTop: '1px solid rgba(24, 32, 31, 0.1)',
        flexWrap: 'wrap',
        gap: 0.5,
        mt: 0.55,
        pt: 0.6,
      }}
    >
      {items.map((item) => (
        <Typography color="text.secondary" component="span" key={item} variant="caption">
          {item}
        </Typography>
      ))}
    </Stack>
  );
}

function TinyStat({ label, value }) {
  return (
    <Stack spacing={0.05} sx={{ minWidth: 0 }}>
      <Typography color="text.secondary" variant="caption">
        {label}
      </Typography>
      <Typography sx={{ fontSize: '0.88rem', fontWeight: 760, overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
    </Stack>
  );
}

function withWelcome(strategyMessages, welcomeMessage) {
  return Array.isArray(strategyMessages) && strategyMessages.length > 0 ? strategyMessages : [welcomeMessage];
}

function hasRealMessages(strategyMessages, welcomeId) {
  return removeWelcome(strategyMessages, welcomeId).length > 0;
}

function removeWelcome(strategyMessages, welcomeId) {
  return strategyMessages.filter((message) => message.id !== welcomeId);
}

function findLatestUsage(strategyMessages) {
  return [...strategyMessages].reverse().find((message) => message.metadata?.usage)?.metadata?.usage || null;
}

function findRequestTokensForMessage(strategyMessages, index) {
  const message = strategyMessages[index];

  if (message?.role !== 'user') {
    return null;
  }

  const nextAgentMessage = strategyMessages.slice(index + 1).find((item) => item.role === 'agent');

  return nextAgentMessage?.metadata?.usage?.tokenReport?.currentRequestTokens ?? null;
}

function formatNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '0';
  }

  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatCost(cost) {
  if (!cost || typeof cost.estimatedUsd !== 'number') {
    return 'нет данных';
  }

  if (cost.estimatedUsd > 0 && cost.estimatedUsd < 0.0001) {
    return '< $0.0001';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: cost.currency || 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(cost.estimatedUsd);
}

function formatDateTime(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(new Date(value));
}

function formatRequestError(error, fallback) {
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return 'Не удалось подключиться к локальному API. Проверьте, что backend запущен и открыт правильный Vite URL.';
  }

  return error instanceof Error ? error.message : fallback;
}

function withAlpha(hex, alpha) {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const rootElement = document.getElementById('root');
const appRoot = rootElement.reactRoot ?? createRoot(rootElement);
rootElement.reactRoot = appRoot;
appRoot.render(<App />);
