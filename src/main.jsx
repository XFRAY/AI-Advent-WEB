import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded';
import MemoryRoundedIcon from '@mui/icons-material/MemoryRounded';
import PsychologyRoundedIcon from '@mui/icons-material/PsychologyRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
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
  shortTermLimit: 8,
};
const INK = '#17201e';
const ACCENTS = {
  shortTerm: '#12675c',
  working: '#8a5a00',
  longTerm: '#3859a7',
};
const MEMORY_LABELS = {
  workingMemory: {
    goal: 'Цель',
    taskData: 'Данные задачи',
    constraints: 'Ограничения',
    openQuestions: 'Открытые вопросы',
    nextSteps: 'Следующие шаги',
  },
  longTermMemory: {
    profile: 'Профиль',
    preferences: 'Предпочтения',
    decisions: 'Решения',
    knowledge: 'Знания',
  },
};
const welcomeMessage = {
  id: 'welcome-memory',
  role: 'agent',
  text:
    'Я агент с явной памятью: диалог сохраняю в short-term, состояние текущей задачи — в working memory, а устойчивые факты и решения — в long-term memory.',
};

const theme = createTheme({
  palette: {
    background: {
      default: '#eef3f1',
      paper: '#ffffff',
    },
    primary: {
      main: ACCENTS.shortTerm,
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
  const [messages, setMessages] = useState([welcomeMessage]);
  const [workingMemory, setWorkingMemory] = useState({});
  const [longTermMemory, setLongTermMemory] = useState({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [modelName, setModelName] = useState('gpt-4o');
  const [modelContextLimit, setModelContextLimit] = useState(DEFAULT_MODEL_CONTEXT_LIMIT);
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [isBooting, setIsBooting] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const inputRef = useRef(null);
  const realMessages = removeWelcome(messages);
  const hasSavedMemory =
    realMessages.length > 0 ||
    hasMemoryValues(workingMemory) ||
    hasMemoryValues(longTermMemory);
  const isOverflow = preview?.tokenReport?.context?.status === 'overflow';
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
        const [memoryResponse, configResponse] = await Promise.all([
          fetch('/api/memory'),
          fetch('/api/config'),
        ]);
        const memoryData = await memoryResponse.json().catch(() => ({}));
        const configData = await configResponse.json().catch(() => ({}));

        if (!memoryResponse.ok) {
          throw new Error(memoryData.error || 'Не удалось загрузить память.');
        }

        if (!isMounted) {
          return;
        }

        setMessages(withWelcome(memoryData.shortTermMessages));
        setWorkingMemory(memoryData.workingMemory ?? {});
        setLongTermMemory(memoryData.longTermMemory ?? {});
        setModelName(configResponse.ok && configData.model ? configData.model : 'gpt-4o');
        setModelContextLimit(
          configResponse.ok && Number.isInteger(configData.modelContextWindow)
            ? configData.modelContextWindow
            : DEFAULT_MODEL_CONTEXT_LIMIT,
        );
        if (configResponse.ok && configData.memoryDefaults) {
          setSettings(configData.memoryDefaults);
        }
      } catch (requestError) {
        setError(formatRequestError(requestError, 'Не удалось загрузить память.'));
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
          throw new Error(data.error || 'Не удалось посчитать контекст.');
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
    messages.length,
    settings.shortTermLimit,
    JSON.stringify(workingMemory),
    JSON.stringify(longTermMemory),
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
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: text, settings }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Не удалось получить ответ агента.');
      }

      setMessages(withWelcome(data.shortTermMessages));
      setWorkingMemory(data.workingMemory ?? {});
      setLongTermMemory(data.longTermMemory ?? {});
      setPreview(null);

      if (data.memoryUpdateStatus === 'pending') {
        scheduleMemoryRefresh();
      }
    } catch (requestError) {
      setError(formatRequestError(requestError, 'Произошла неизвестная ошибка.'));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  async function handleReset() {
    if (isLoading || isBooting || isResetting || !hasSavedMemory) {
      return;
    }

    setError('');
    setIsResetting(true);

    try {
      const response = await fetch('/api/memory', {
        method: 'DELETE',
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Не удалось очистить память.');
      }

      setMessages([welcomeMessage]);
      setWorkingMemory(data.workingMemory ?? {});
      setLongTermMemory(data.longTermMemory ?? {});
      setPreview(null);
    } catch (requestError) {
      setError(formatRequestError(requestError, 'Не удалось очистить память.'));
    } finally {
      setIsResetting(false);
      inputRef.current?.focus();
    }
  }

  function updateSettings(key, value) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function refreshMemorySnapshot() {
    const response = await fetch('/api/memory');
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Не удалось обновить память.');
    }

    setMessages(withWelcome(data.shortTermMessages));
    setWorkingMemory(data.workingMemory ?? {});
    setLongTermMemory(data.longTermMemory ?? {});
  }

  function scheduleMemoryRefresh(attempt = 0) {
    const delays = [900, 2200, 4200, 7000];

    if (attempt >= delays.length) {
      return;
    }

    window.setTimeout(async () => {
      try {
        await refreshMemorySnapshot();
      } catch {
        return;
      }

      scheduleMemoryRefresh(attempt + 1);
    }, delays[attempt]);
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        component="main"
        sx={{
          background:
            'linear-gradient(118deg, rgba(18, 103, 92, 0.15) 0%, rgba(238, 243, 241, 0.96) 38%, rgba(138, 90, 0, 0.12) 70%, rgba(56, 89, 167, 0.13) 100%), #eef3f1',
          minHeight: '100vh',
          p: { xs: 1, md: 2 },
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gap: 1.25,
            gridTemplateRows: 'auto minmax(0, 1fr) auto',
            height: 'calc(100vh - 32px)',
            maxWidth: 1760,
            minHeight: 0,
            mx: 'auto',
          }}
        >
          <Header
            disabled={isLoading || isBooting || isResetting}
            modelContextLimit={modelContextLimit}
            modelName={modelName}
            onChange={updateSettings}
            preview={preview}
            settings={settings}
          />

          <Box
            sx={{
              display: 'grid',
              gap: 1.25,
              gridTemplateColumns: {
                xs: '1fr',
                lg: 'repeat(3, minmax(0, 1fr))',
              },
              height: '100%',
              minHeight: 0,
            }}
          >
            <MemoryLayerPanel
              accent={ACCENTS.working}
              changedKeys={findLatestMemoryChanges(realMessages).workingMemory}
              icon={<Inventory2RoundedIcon />}
              labels={MEMORY_LABELS.workingMemory}
              memory={workingMemory}
              subtitle="Состояние всей текущей задачи и диалога"
              title="Working memory"
            />
            <ChatPanel
              isBooting={isBooting}
              isLoading={isLoading}
              messages={messages}
              preview={preview}
            />
            <MemoryLayerPanel
              accent={ACCENTS.longTerm}
              changedKeys={findLatestMemoryChanges(realMessages).longTermMemory}
              icon={<PsychologyRoundedIcon />}
              labels={MEMORY_LABELS.longTermMemory}
              memory={longTermMemory}
              subtitle="То, что переносится между задачами и чатами"
              title="Long-term memory"
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
                  Следующий запрос превышает лимит контекста модели.
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
                  placeholder="Напишите агенту. Он явно выберет, что сохранить в каждый слой памяти."
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
                    background: ACCENTS.shortTerm,
                    minHeight: { xs: 40, sm: 42 },
                    minWidth: { xs: '100%', sm: 150 },
                    '&:hover': {
                      background: '#0c584f',
                    },
                  }}
                  type="submit"
                  variant="contained"
                >
                  {isLoading ? 'Жду ответ' : 'Отправить'}
                </Button>
              </Stack>
            </Stack>

            <Box sx={{ alignSelf: 'end', justifySelf: { xs: 'start', lg: 'end' } }}>
              <Tooltip title="Очистить все три слоя памяти">
                <span>
                  <IconButton
                    aria-label="Очистить память"
                    color="error"
                    disabled={isLoading || isBooting || isResetting || !hasSavedMemory}
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

function Header({ disabled, modelContextLimit, modelName, onChange, preview, settings }) {
  return (
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
        flexWrap: 'wrap',
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
          AI Advent · День 11
        </Box>
        <Typography color="text.secondary" variant="caption">
          {modelName} · окно {formatNumber(modelContextLimit)} ток.
        </Typography>
      </Stack>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1}
        sx={{
          alignItems: { xs: 'stretch', md: 'center' },
          flex: { xs: '1 1 100%', lg: '0 1 auto' },
        }}
      >
        <ContextInspector compact preview={preview} settings={settings} />
        <ShortTermWindowControl disabled={disabled} onChange={onChange} settings={settings} />
      </Stack>
    </Paper>
  );
}

function ShortTermWindowControl({ disabled, onChange, settings }) {
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
        <TuneRoundedIcon sx={{ color: ACCENTS.shortTerm, fontSize: 18 }} />
        <Typography color="text.secondary" fontWeight={780} variant="caption">
          Short-term окно
        </Typography>
      </Stack>
      <TextField
        disabled={disabled}
        fullWidth
        inputProps={{ 'aria-label': 'Short-term окно', max: 30, min: 2, step: 1 }}
        onChange={(event) => onChange('shortTermLimit', Number(event.target.value))}
        sx={{
          '& .MuiOutlinedInput-input': {
            py: 0.65,
          },
        }}
        type="number"
        value={settings.shortTermLimit}
      />
    </Box>
  );
}

function ChatPanel({ isBooting, isLoading, messages, preview }) {
  const scrollRef = useRef(null);
  const latestUsage = useMemo(() => findLatestUsage(messages), [messages]);

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
        gridTemplateRows: 'auto minmax(0, 1fr)',
        minHeight: { xs: 480, lg: 0 },
        overflow: 'hidden',
      }}
    >
      <Box
        component="header"
        sx={{
          background: `linear-gradient(135deg, ${withAlpha(ACCENTS.shortTerm, 0.14)} 0%, rgba(255,255,255,0.9) 72%)`,
          borderBottom: '1px solid rgba(24, 32, 31, 0.1)',
          display: 'grid',
          gap: 0.8,
          p: { xs: 1.1, md: 1.25 },
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Stack spacing={0.2} sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={0.7} sx={{ alignItems: 'center' }}>
              <HistoryRoundedIcon sx={{ color: ACCENTS.shortTerm }} />
              <Typography component="h2" sx={{ color: ACCENTS.shortTerm }} variant="h2">
                Short-term memory
              </Typography>
            </Stack>
            <Typography color="text.secondary" variant="caption">
              Текущий диалог, который уходит в модель последними сообщениями
            </Typography>
          </Stack>
          <Box sx={{ background: ACCENTS.shortTerm, borderRadius: 1, height: 12, width: 12 }} />
        </Stack>
        <ContextMeter latestUsage={latestUsage} previewReport={preview?.tokenReport} />
      </Box>

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
            key={message.id}
            message={message}
            requestTokens={findRequestTokensForMessage(messages, index)}
          />
        ))}
        {isLoading && (
          <MessageBubble
            isLoading
            message={{
              id: 'memory-loading',
              role: 'agent',
              text: 'Думаю и готовлю обновление памяти...',
            }}
          />
        )}
        {isBooting && (
          <MessageBubble
            isLoading
            message={{
              id: 'memory-booting',
              role: 'agent',
              text: 'Загружаю память...',
            }}
          />
        )}
      </Box>
    </Paper>
  );
}

function MemoryLayerPanel({ accent, changedKeys = [], icon, labels, memory, subtitle, title }) {
  return (
    <Paper
      component="section"
      elevation={0}
      sx={{
        background: '#ffffff',
        border: '1px solid rgba(24, 32, 31, 0.13)',
        borderRadius: 2,
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr)',
        minHeight: { xs: 420, lg: 0 },
        overflow: 'hidden',
      }}
    >
      <Box
        component="header"
        sx={{
          background: `linear-gradient(135deg, ${withAlpha(accent, 0.13)} 0%, rgba(255,255,255,0.9) 72%)`,
          borderBottom: '1px solid rgba(24, 32, 31, 0.1)',
          p: { xs: 1.1, md: 1.25 },
        }}
      >
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Box sx={{ color: accent, display: 'inline-flex' }}>{icon}</Box>
          <Stack spacing={0.2} sx={{ minWidth: 0 }}>
            <Typography component="h2" sx={{ color: accent }} variant="h2">
              {title}
            </Typography>
            <Typography color="text.secondary" variant="caption">
              {subtitle}
            </Typography>
          </Stack>
        </Stack>
      </Box>
      <Stack
        spacing={0.7}
        sx={{
          minHeight: 0,
          overflowY: 'auto',
          p: { xs: 1.1, md: 1.25 },
        }}
      >
        {Object.entries(labels).map(([key, label]) => {
          const changed = changedKeys.includes(key);

          return (
            <Box
              key={key}
              sx={{
                border: `1px solid ${changed ? withAlpha(accent, 0.38) : 'rgba(24, 32, 31, 0.09)'}`,
                borderRadius: 1.25,
                p: 0.85,
              }}
            >
              <Stack direction="row" spacing={0.7} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ color: accent, fontWeight: 780 }} variant="caption">
                  {label}
                </Typography>
                {changed && (
                  <Typography color="text.secondary" variant="caption">
                    saved
                  </Typography>
                )}
              </Stack>
              <Typography sx={{ mt: 0.35, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }} variant="body2">
                {formatMemoryValue(memory?.[key]) || '—'}
              </Typography>
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}

function ContextInspector({ compact = false, preview, settings }) {
  const stats = preview?.stats;

  return (
    <Paper
      component="section"
      elevation={0}
      sx={{
        background: compact ? 'rgba(255,255,255,0.68)' : '#ffffff',
        border: '1px solid rgba(24, 32, 31, 0.13)',
        borderRadius: compact ? 1.5 : 2,
        minWidth: { xs: '100%', md: compact ? 520 : 'auto' },
        p: compact ? 0.75 : { xs: 1.1, md: 1.25 },
      }}
    >
      <Stack spacing={compact ? 0.45 : 0.85}>
        <Stack direction="row" spacing={0.7} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}>
          <MemoryRoundedIcon sx={{ color: INK, fontSize: compact ? 18 : 20 }} />
          <Typography component="h2" sx={{ fontWeight: 780 }} variant={compact ? 'caption' : 'h2'}>
            Context payload
          </Typography>
          <TinyStat label="Short-term limit" value={formatNumber(settings.shortTermLimit)} />
          <TinyStat label="Short-term sent" value={formatNumber(stats?.shortTermSentCount)} />
          <TinyStat label="Dropped" value={formatNumber(stats?.shortTermDroppedCount)} />
          <TinyStat label="Working chars" value={formatNumber(stats?.workingMemoryCharacters)} />
          <TinyStat label="Long-term chars" value={formatNumber(stats?.longTermMemoryCharacters)} />
        </Stack>
        {!compact && (
          <Typography color="text.secondary" variant="caption">
            Порядок отправки: system prompt → long-term → working → recent short-term → текущий ввод.
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

function ContextMeter({ latestUsage, previewReport }) {
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
            background: ACCENTS.shortTerm,
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
          память+история: {formatNumber(report?.conversationHistoryTokens)} ток.
        </Typography>
      </Stack>
    </Stack>
  );
}

function MessageBubble({ message, isLoading = false, requestTokens = null }) {
  const isUser = message.role === 'user';

  return (
    <Paper
      component="article"
      elevation={0}
      sx={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        background: isUser
          ? `linear-gradient(135deg, ${withAlpha(ACCENTS.shortTerm, 0.16)} 0%, rgba(255,255,255,0.92) 100%)`
          : 'linear-gradient(180deg, #ffffff 0%, #f7faf8 100%)',
        border: '1px solid rgba(24, 32, 31, 0.1)',
        borderRadius: 2,
        boxShadow: isUser
          ? `0 14px 30px ${withAlpha(ACCENTS.shortTerm, 0.09)}`
          : '0 14px 30px rgba(24, 32, 31, 0.07)',
        maxWidth: { xs: '100%', md: '88%' },
        px: 1,
        py: 0.9,
      }}
    >
      <Stack spacing={0.55}>
        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
          <Box aria-hidden="true" sx={{ background: ACCENTS.shortTerm, borderRadius: 1, height: 8, width: 8 }} />
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
  const { model, usage, memoryChanges } = metadata;
  const items = [
    'memory-layers',
    model || 'unknown',
    `input: ${formatNumber(usage?.inputTokens)} ток.`,
    `output: ${formatNumber(usage?.outputTokens)} ток.`,
    formatCost(usage?.cost),
  ];
  const working = memoryChanges?.workingMemory ?? [];
  const longTerm = memoryChanges?.longTermMemory ?? [];

  if (working.length > 0) {
    items.push(`working: ${working.join(', ')}`);
  }

  if (longTerm.length > 0) {
    items.push(`long-term: ${longTerm.join(', ')}`);
  }

  if (working.length === 0 && longTerm.length === 0) {
    items.push('память без изменений');
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

function withWelcome(shortTermMessages) {
  return Array.isArray(shortTermMessages) && shortTermMessages.length > 0
    ? shortTermMessages
    : [welcomeMessage];
}

function removeWelcome(strategyMessages) {
  return strategyMessages.filter((message) => message.id !== welcomeMessage.id);
}

function findLatestUsage(strategyMessages) {
  return [...strategyMessages].reverse().find((message) => message.metadata?.usage)?.metadata?.usage || null;
}

function findLatestMemoryChanges(strategyMessages) {
  return (
    [...strategyMessages].reverse().find((message) => message.metadata?.memoryChanges)?.metadata
      ?.memoryChanges || {
      workingMemory: [],
      longTermMemory: [],
    }
  );
}

function findRequestTokensForMessage(strategyMessages, index) {
  const message = strategyMessages[index];

  if (message?.role !== 'user') {
    return null;
  }

  const nextAgentMessage = strategyMessages.slice(index + 1).find((item) => item.role === 'agent');

  return nextAgentMessage?.metadata?.usage?.tokenReport?.currentRequestTokens ?? null;
}

function hasMemoryValues(memory) {
  return Object.values(memory ?? {}).some((value) => typeof value === 'string' && value.trim());
}

function formatMemoryValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => formatMemoryValue(item)).filter(Boolean).join('; ');
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value == null) {
    return '';
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, nestedValue]) => nestedValue != null && nestedValue !== '')
      .map(([nestedKey, nestedValue]) => `${nestedKey}: ${formatMemoryValue(nestedValue)}`)
      .join('; ');
  }

  return String(value);
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
