import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import MemoryRoundedIcon from '@mui/icons-material/MemoryRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import SettingsSuggestRoundedIcon from '@mui/icons-material/SettingsSuggestRounded';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  CssBaseline,
  Divider,
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
const DEFAULT_COMPRESSION = {
  lastMessagesCount: 6,
  summaryBatchSize: 10,
};
const FULL_ACCENT = '#0f6b5f';
const COMPRESSED_ACCENT = '#c45f3d';
const INK = '#17201e';
const welcomeFullMessage = {
  id: 'welcome-full',
  role: 'agent',
  text: 'Я отвечаю с полной историей. Токены будут расти быстро.',
};
const welcomeCompressedMessage = {
  id: 'welcome-compressed',
  role: 'agent',
  text: 'Я отвечаю с summary старой истории и последними сообщениями как есть.',
};

const theme = createTheme({
  palette: {
    background: {
      default: '#eef3f1',
      paper: '#ffffff',
    },
    primary: {
      main: FULL_ACCENT,
    },
    secondary: {
      main: COMPRESSED_ACCENT,
    },
    text: {
      primary: INK,
      secondary: '#66706d',
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
      fontSize: 'clamp(1.45rem, 2vw, 2.2rem)',
      fontWeight: 780,
      letterSpacing: 0,
      lineHeight: 1.05,
    },
    h2: {
      fontSize: '1rem',
      fontWeight: 780,
      letterSpacing: 0,
      lineHeight: 1.2,
    },
    body2: {
      fontSize: '0.94rem',
      lineHeight: 1.55,
    },
    caption: {
      fontSize: '0.8rem',
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
          minHeight: 42,
          textTransform: 'none',
          whiteSpace: 'nowrap',
        },
        contained: {
          background: FULL_ACCENT,
          boxShadow: '0 14px 28px rgba(15, 107, 95, 0.18)',
          '&:hover': {
            background: '#0b5b51',
            boxShadow: '0 16px 32px rgba(15, 107, 95, 0.22)',
          },
          '&.Mui-disabled': {
            background: 'rgba(24, 32, 31, 0.08)',
            boxShadow: 'none',
          },
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
  const [fullMessages, setFullMessages] = useState([welcomeFullMessage]);
  const [compressedMessages, setCompressedMessages] = useState([welcomeCompressedMessage]);
  const [summary, setSummary] = useState(null);
  const [compression, setCompression] = useState(DEFAULT_COMPRESSION);
  const [modelName, setModelName] = useState('gpt-4o-mini');
  const [modelContextLimit, setModelContextLimit] = useState(DEFAULT_MODEL_CONTEXT_LIMIT);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBooting, setIsBooting] = useState(true);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [lastComparison, setLastComparison] = useState(null);
  const inputRef = useRef(null);
  const hasSavedMessages =
    hasRealMessages(fullMessages, welcomeFullMessage.id) ||
    hasRealMessages(compressedMessages, welcomeCompressedMessage.id);

  const fullLatestUsage = useMemo(() => findLatestUsage(fullMessages), [fullMessages]);
  const compressedLatestUsage = useMemo(
    () => findLatestUsage(compressedMessages),
    [compressedMessages],
  );
  const activeComparison = preview?.comparison ?? lastComparison;
  const fullPreviewReport = preview?.full?.tokenReport ?? fullLatestUsage?.tokenReport;
  const compressedPreviewReport =
    preview?.compressed?.tokenReport ?? compressedLatestUsage?.tokenReport;
  const isOverflow =
    fullPreviewReport?.context?.status === 'overflow' ||
    compressedPreviewReport?.context?.status === 'overflow';
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
          throw new Error(messagesData.error || 'Не удалось загрузить историю.');
        }

        if (!isMounted) {
          return;
        }

        const savedFullMessages = Array.isArray(messagesData.fullMessages)
          ? messagesData.fullMessages
          : [];
        const savedCompressedMessages = Array.isArray(messagesData.compressedMessages)
          ? messagesData.compressedMessages
          : [];

        setFullMessages(savedFullMessages.length > 0 ? savedFullMessages : [welcomeFullMessage]);
        setCompressedMessages(
          savedCompressedMessages.length > 0
            ? savedCompressedMessages
            : [welcomeCompressedMessage],
        );
        setSummary(messagesData.summary ?? null);
        setModelName(configResponse.ok && configData.model ? configData.model : 'gpt-4o-mini');
        setModelContextLimit(
          configResponse.ok && Number.isInteger(configData.modelContextWindow)
            ? configData.modelContextWindow
            : DEFAULT_MODEL_CONTEXT_LIMIT,
        );
        if (configResponse.ok && configData.compressionDefaults) {
          setCompression(configData.compressionDefaults);
        }
      } catch (requestError) {
        setError(
          formatRequestError(requestError, 'Не удалось загрузить историю.'),
        );
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
      setIsPreviewLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const message = input.trim();

    setIsPreviewLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/context-preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message, compression }),
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
      } finally {
        if (!controller.signal.aborted) {
          setIsPreviewLoading(false);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [
    compression.lastMessagesCount,
    compression.summaryBatchSize,
    compressedMessages.length,
    fullMessages.length,
    input,
    isBooting,
    isResetting,
  ]);

  async function handleSubmit(event) {
    event.preventDefault();

    const text = input.trim();
    if (!text || !canSend) {
      return;
    }

    const optimisticFullUser = {
      id: crypto.randomUUID(),
      mode: 'full',
      role: 'user',
      text,
    };
    const optimisticCompressedUser = {
      id: crypto.randomUUID(),
      mode: 'compressed',
      role: 'user',
      text,
    };

    setError('');
    setInput('');
    setIsLoading(true);
    setFullMessages((messages) => [...removeWelcome(messages, welcomeFullMessage.id), optimisticFullUser]);
    setCompressedMessages((messages) => [
      ...removeWelcome(messages, welcomeCompressedMessage.id),
      optimisticCompressedUser,
    ]);

    try {
      const response = await fetch('/api/chat/compare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: text, compression }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Не удалось получить ответы агентов.');
      }

      setFullMessages((messages) => [
        ...replaceMessage(messages, optimisticFullUser.id, data.full?.userMessage),
        data.full?.agentMessage ?? buildFallbackAgentMessage(data.full?.answer, data.full),
      ]);
      setCompressedMessages((messages) => [
        ...replaceMessage(messages, optimisticCompressedUser.id, data.compressed?.userMessage),
        data.compressed?.agentMessage ??
          buildFallbackAgentMessage(data.compressed?.answer, data.compressed),
      ]);
      setSummary(data.compressed?.summary ?? summary);
      setLastComparison(data.comparison ?? null);
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
        throw new Error(data.error || 'Не удалось очистить историю.');
      }

      setFullMessages([welcomeFullMessage]);
      setCompressedMessages([welcomeCompressedMessage]);
      setSummary(null);
      setPreview(null);
      setLastComparison(null);
    } catch (requestError) {
      setError(formatRequestError(requestError, 'Не удалось очистить историю.'));
    } finally {
      setIsResetting(false);
      inputRef.current?.focus();
    }
  }

  function updateCompression(key, value) {
    setCompression((current) => ({
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
            'linear-gradient(118deg, rgba(15, 107, 95, 0.18) 0%, rgba(15, 107, 95, 0.06) 36%, rgba(196, 95, 61, 0.15) 72%, rgba(42, 68, 82, 0.12) 100%), #eef3f1',
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
            maxWidth: 1500,
            mx: 'auto',
            minHeight: { xs: '100vh', xl: 0 },
          }}
        >
          <Paper
            component="header"
            elevation={0}
            sx={{
              background: 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(241,248,246,0.94) 45%, rgba(255,246,241,0.95) 100%)',
              border: '1px solid rgba(24, 32, 31, 0.12)',
              borderRadius: 2,
              display: 'grid',
              gap: 1.25,
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(230px, 0.42fr) minmax(0, 1.58fr)' },
              p: { xs: 1.2, md: 1.5 },
            }}
          >
            <Stack spacing={1}>
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
                  AI Advent · День 9
                </Box>
                <Typography color="text.secondary" variant="caption">
                  {modelName} · окно {formatNumber(modelContextLimit)} ток.
                </Typography>
              </Stack>
            </Stack>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ minWidth: 0 }}
            >
              <TokenComparison comparison={activeComparison} />
              <SummaryStatus summary={summary} />
            </Stack>
          </Paper>

          <Box
            sx={{
              display: 'grid',
              gap: 1.25,
              gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
              minHeight: 0,
            }}
          >
            <ChatPanel
              accent={FULL_ACCENT}
              headerBackground="linear-gradient(135deg, rgba(15, 107, 95, 0.13) 0%, rgba(255, 255, 255, 0.86) 72%)"
              isBooting={isBooting}
              isLoading={isLoading}
              messages={fullMessages}
              previewReport={fullPreviewReport}
              title="Без сжатия"
              subtitle="В модель уходит вся история диалога"
              welcomeId={welcomeFullMessage.id}
            />
            <ChatPanel
              accent={COMPRESSED_ACCENT}
              headerBackground="linear-gradient(135deg, rgba(196, 95, 61, 0.15) 0%, rgba(255, 255, 255, 0.86) 72%)"
              compressionStats={preview?.compressed?.compressionStats}
              isBooting={isBooting}
              isLoading={isLoading}
              messages={compressedMessages}
              previewReport={compressedPreviewReport}
              title="Со сжатием"
              subtitle={`Summary + последние ${compression.lastMessagesCount} сообщений`}
              welcomeId={welcomeCompressedMessage.id}
              extraHeader={
                <CompressionControls
                  compression={compression}
                  disabled={isLoading || isBooting || isResetting}
                  onChange={updateCompression}
                />
              }
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
              gap: 1,
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) auto' },
              p: { xs: 1, md: 1.25 },
            }}
          >
            <Stack spacing={1}>
              {error && (
                <Alert severity="error" sx={{ borderRadius: 1.5 }}>
                  {error}
                </Alert>
              )}
              {isOverflow && !error && (
                <Alert severity="warning" sx={{ borderRadius: 1.5 }}>
                  Следующий запрос превышает лимит контекста в одном из режимов.
                </Alert>
              )}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  disabled={isLoading || isBooting || isResetting}
                  fullWidth
                  inputRef={inputRef}
                  maxRows={5}
                  minRows={2}
                  multiline
                  onChange={(event) => {
                    setInput(event.target.value);
                    setError('');
                  }}
                  placeholder="Один запрос уйдет сразу в оба чата"
                  value={input}
                />
                <Button
                  disabled={!canSend}
                  endIcon={isLoading ? <CircularProgress color="inherit" size={16} /> : <SendRoundedIcon />}
                  sx={{
                    alignSelf: 'stretch',
                    background: FULL_ACCENT,
                    '&:hover': {
                      background: '#0b5b51',
                    },
                    minHeight: { xs: 48, sm: 68 },
                    minWidth: { xs: '100%', sm: 140 },
                  }}
                  type="submit"
                  variant="contained"
                >
                  {isLoading ? 'Жду ответ' : 'Отправить'}
                </Button>
              </Stack>
            </Stack>

            <Box sx={{ alignSelf: 'end', justifySelf: { xs: 'start', lg: 'end' } }}>
              <Tooltip title="Очистить обе истории и summary">
                <span>
                  <IconButton
                    aria-label="Очистить историю"
                    color="error"
                    disabled={isLoading || isBooting || isResetting || !hasSavedMessages}
                    onClick={handleReset}
                    sx={{
                      background: 'rgba(185, 71, 71, 0.08)',
                      border: '1px solid rgba(185, 71, 71, 0.18)',
                      height: 42,
                      width: 42,
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

function ChatPanel({
  accent,
  compressionStats = null,
  extraHeader = null,
  headerBackground,
  isBooting,
  isLoading,
  messages,
  previewReport,
  subtitle,
  title,
  welcomeId,
}) {
  const scrollRef = useRef(null);
  const realMessages = removeWelcome(messages, welcomeId);
  const latestUsage = findLatestUsage(messages);

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
        minHeight: { xs: 560, lg: 0 },
        overflow: 'hidden',
      }}
    >
      <Box
        component="header"
        sx={{
          background: headerBackground,
          borderBottom: '1px solid rgba(24, 32, 31, 0.1)',
          display: 'grid',
          gap: 0.8,
          p: { xs: 1.1, md: 1.25 },
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Stack spacing={0.2}>
            <Typography component="h2" sx={{ color: accent }} variant="h2">
              {title}
            </Typography>
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

      {compressionStats && (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            background: 'rgba(196, 95, 61, 0.1)',
            borderBottom: '1px solid rgba(24, 32, 31, 0.08)',
            flexWrap: 'wrap',
            gap: 0.8,
            px: 1.25,
            py: 0.8,
          }}
        >
          <TinyStat label="Дословно в запросе" value={formatNumber(compressionStats.rawRecentMessageCount)} />
          <TinyStat label="Символов summary" value={formatNumber(compressionStats.summaryCharacters)} />
          <TinyStat label="Ждут batch" value={formatNumber(compressionStats.pendingSummaryMessageCount)} />
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
            key={message.id}
            message={message}
            requestTokens={findRequestTokensForMessage(messages, index)}
          />
        ))}
        {isLoading && (
          <MessageBubble
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
            Начните диалог, чтобы увидеть отличие в расходе токенов.
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

function CompressionControls({ compression, disabled, onChange }) {
  return (
    <Box
      sx={{
        background: 'linear-gradient(135deg, rgba(196, 95, 61, 0.1) 0%, rgba(255,255,255,0.9) 70%)',
        border: '1px solid rgba(24, 32, 31, 0.1)',
        borderRadius: 1.5,
        p: 1,
      }}
    >
      <Stack direction="row" spacing={0.8} sx={{ alignItems: 'center', mb: 1 }}>
        <SettingsSuggestRoundedIcon sx={{ color: COMPRESSED_ACCENT, fontSize: 18 }} />
        <Typography color="text.secondary" fontWeight={780} variant="caption">
          Как сжимать правый чат
        </Typography>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <CompressionNumberField
          description="Столько последних сообщений останется в запросе без изменений."
          disabled={disabled}
          label="Оставлять дословно"
          max={30}
          min={2}
          onChange={(event) => onChange('lastMessagesCount', Number(event.target.value))}
          value={compression.lastMessagesCount}
        />
        <CompressionNumberField
          description="Когда накопится столько старых сообщений, они свернутся в summary."
          disabled={disabled}
          label="Обновлять summary каждые"
          max={50}
          min={2}
          onChange={(event) => onChange('summaryBatchSize', Number(event.target.value))}
          value={compression.summaryBatchSize}
        />
      </Stack>
    </Box>
  );
}

function CompressionNumberField({ description, disabled, label, max, min, onChange, value }) {
  return (
    <Stack spacing={0.45} sx={{ flex: 1, minWidth: 0 }}>
      <Typography
        color="text.secondary"
        component="label"
        sx={{ fontSize: '0.78rem', fontWeight: 720, lineHeight: 1.2 }}
      >
        {label}
      </Typography>
      <TextField
        disabled={disabled}
        fullWidth
        inputProps={{ 'aria-label': label, max, min, step: 1 }}
        onChange={onChange}
        sx={{
          '& .MuiOutlinedInput-input': {
            py: 0.9,
          },
        }}
        type="number"
        value={value}
      />
      <Typography color="text.secondary" sx={{ fontSize: '0.76rem', lineHeight: 1.25 }}>
        {description}
      </Typography>
    </Stack>
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

function MessageBubble({ message, isLoading = false, requestTokens = null }) {
  const isUser = message.role === 'user';

  return (
    <Paper
      component="article"
      elevation={0}
      sx={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        background: isUser
          ? 'linear-gradient(135deg, rgba(15, 107, 95, 0.14) 0%, rgba(196, 95, 61, 0.1) 100%)'
          : 'linear-gradient(180deg, #ffffff 0%, #f7faf8 100%)',
        border: '1px solid',
        borderColor: isUser ? 'rgba(20, 92, 82, 0.18)' : 'rgba(24, 32, 31, 0.1)',
        borderRadius: 2,
        boxShadow: isUser
          ? '0 14px 30px rgba(20, 92, 82, 0.1)'
          : '0 14px 30px rgba(24, 32, 31, 0.07)',
        maxWidth: { xs: '100%', md: '86%' },
        px: 1,
        py: 0.9,
      }}
    >
      <Stack spacing={0.55}>
        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
          <Box
            aria-hidden="true"
            sx={{
              background: isUser ? FULL_ACCENT : COMPRESSED_ACCENT,
              borderRadius: 1,
              height: 8,
              width: 8,
            }}
          />
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
    model || 'unknown',
    `input: ${formatNumber(usage?.inputTokens)} ток.`,
    `output: ${formatNumber(usage?.outputTokens)} ток.`,
    formatCost(usage?.cost),
  ];

  if (metadata.compression?.summaryUpdated) {
    items.push('summary обновлен');
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

function TokenComparison({ comparison }) {
  return (
    <Box
      sx={{
        background: 'linear-gradient(135deg, rgba(15, 107, 95, 0.1) 0%, rgba(255,255,255,0.92) 72%)',
        border: '1px solid rgba(24, 32, 31, 0.1)',
        borderRadius: 1.5,
        flex: 1,
        minHeight: 88,
        minWidth: 0,
        p: 1,
      }}
    >
      <Typography color="text.secondary" fontWeight={780} sx={{ mb: 0.8 }} variant="caption">
        Сколько токенов уйдет в следующий запрос
      </Typography>
      <Stack
        direction="row"
        divider={<Divider flexItem orientation="vertical" />}
        spacing={1}
        sx={{ justifyContent: 'space-between' }}
      >
        <TinyStat
          label="Полная история"
          value={comparison ? `${formatNumber(comparison.fullInputTokens)} ток.` : 'после ввода'}
        />
        <TinyStat
          label="Со summary"
          value={comparison ? `${formatNumber(comparison.compressedInputTokens)} ток.` : 'после ввода'}
        />
        <TinyStat
          label="Экономия"
          value={comparison ? formatPercent(comparison.inputTokenSavingsPercent) : 'пока нет'}
        />
      </Stack>
    </Box>
  );
}

function SummaryStatus({ summary }) {
  const hasSummary = Boolean(summary?.text);

  return (
    <Box
      sx={{
        background: 'linear-gradient(135deg, rgba(196, 95, 61, 0.11) 0%, rgba(255,255,255,0.92) 72%)',
        border: '1px solid rgba(24, 32, 31, 0.1)',
        borderRadius: 1.5,
        flex: 1,
        minHeight: 88,
        minWidth: 0,
        p: 1,
      }}
    >
      <Typography color="text.secondary" fontWeight={780} sx={{ mb: 0.8 }} variant="caption">
        Что уже заменено summary
      </Typography>
      <Stack
        direction="row"
        divider={<Divider flexItem orientation="vertical" />}
        spacing={1}
        sx={{ justifyContent: 'space-between' }}
      >
        <TinyStat
          label="Сообщений сжато"
          value={hasSummary ? formatNumber(summary.summarizedMessageCount) : 'пока 0'}
        />
        <TinyStat
          label="Размер summary"
          value={hasSummary ? `${formatNumber(summary.text.length)} симв.` : 'summary еще нет'}
        />
      </Stack>
    </Box>
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

function hasRealMessages(messages, welcomeId) {
  return removeWelcome(messages, welcomeId).length > 0;
}

function removeWelcome(messages, welcomeId) {
  return messages.filter((message) => message.id !== welcomeId);
}

function replaceMessage(messages, id, replacement) {
  if (!replacement) {
    return messages;
  }

  return messages.map((message) => (message.id === id ? replacement : message));
}

function buildFallbackAgentMessage(answer, result) {
  return {
    id: crypto.randomUUID(),
    role: 'agent',
    text: answer || 'Модель не вернула текстовый ответ.',
    metadata: {
      model: result?.model,
      usage: result?.usage,
      settings: result?.settings,
    },
  };
}

function findLatestUsage(messages) {
  return [...messages].reverse().find((message) => message.metadata?.usage)?.metadata?.usage || null;
}

function findRequestTokensForMessage(messages, index) {
  const message = messages[index];

  if (message?.role !== 'user') {
    return null;
  }

  const nextAgentMessage = messages.slice(index + 1).find((item) => item.role === 'agent');

  return nextAgentMessage?.metadata?.usage?.tokenReport?.currentRequestTokens ?? null;
}

function formatNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '0';
  }

  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '0%';
  }

  return `${new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 1,
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
  }).format(value)}%`;
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

const rootElement = document.getElementById('root');
const appRoot = rootElement.reactRoot ?? createRoot(rootElement);
rootElement.reactRoot = appRoot;
appRoot.render(<App />);
