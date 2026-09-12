import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import MemoryRoundedIcon from '@mui/icons-material/MemoryRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import SettingsSuggestRoundedIcon from '@mui/icons-material/SettingsSuggestRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
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

const welcomeMessage = {
  id: 'welcome-day-8',
  role: 'agent',
  text: 'Привет! Чем могу помочь?',
};
const DEFAULT_MODEL_CONTEXT_LIMIT = 16_385;

const theme = createTheme({
  palette: {
    background: {
      default: '#f4f6f2',
      paper: '#ffffff',
    },
    primary: {
      main: '#145c52',
    },
    secondary: {
      main: '#b45f3c',
    },
    text: {
      primary: '#18201f',
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
      fontSize: 'clamp(1.7rem, 2.4vw, 2.55rem)',
      fontWeight: 780,
      letterSpacing: 0,
      lineHeight: 1,
    },
    h2: {
      fontSize: '1.05rem',
      fontWeight: 760,
      letterSpacing: 0,
      lineHeight: 1.15,
    },
    body2: {
      fontSize: '0.95rem',
      lineHeight: 1.6,
    },
    caption: {
      fontSize: '0.82rem',
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
          alignItems: 'center',
          borderRadius: 8,
          display: 'inline-flex',
          fontWeight: 720,
          justifyContent: 'center',
          minHeight: 44,
          textTransform: 'none',
          whiteSpace: 'nowrap',
          '& .MuiButton-endIcon': {
            alignItems: 'center',
            display: 'inline-flex',
            marginLeft: 8,
          },
          '& .MuiButton-endIcon svg': {
            fontSize: 20,
          },
        },
        contained: {
          background: 'linear-gradient(135deg, #145c52 0%, #d2784f 100%)',
          boxShadow: '0 16px 32px rgba(20, 92, 82, 0.2)',
          '&.Mui-disabled': {
            background: 'rgba(24, 32, 31, 0.08)',
            boxShadow: 'none',
          },
          '&.MuiButton-containedError': {
            background: '#b94747',
            boxShadow: '0 12px 26px rgba(185, 71, 71, 0.18)',
          },
        },
        outlined: {
          borderColor: 'rgba(24, 32, 31, 0.16)',
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
            borderRadius: 12,
            boxShadow: 'inset 0 1px 2px rgba(24, 32, 31, 0.04)',
            fontSize: '1rem',
            lineHeight: 1.55,
          },
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(24, 32, 31, 0.14)',
          },
          '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(20, 92, 82, 0.42)',
          },
        },
      },
    },
  },
});

function removeWelcomeMessage(messages) {
  return messages.filter((message) => message.id !== welcomeMessage.id);
}

function findRequestTokensForMessage(messages, index) {
  const message = messages[index];

  if (message?.role !== 'user') {
    return null;
  }

  const nextAgentMessage = messages.slice(index + 1).find((item) => item.role === 'agent');

  return nextAgentMessage?.metadata?.usage?.tokenReport?.currentRequestTokens ?? null;
}

function App() {
  const [messages, setMessages] = useState([welcomeMessage]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isResetting, setIsResetting] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [modelName, setModelName] = useState('gpt-3.5-turbo');
  const [modelContextLimit, setModelContextLimit] = useState(DEFAULT_MODEL_CONTEXT_LIMIT);
  const [error, setError] = useState('');
  const [errorDetails, setErrorDetails] = useState(null);
  const [draftTokenReport, setDraftTokenReport] = useState(null);
  const [draftPreviewError, setDraftPreviewError] = useState('');
  const [isDraftPreviewLoading, setIsDraftPreviewLoading] = useState(false);
  const chatScrollRef = useRef(null);
  const inputRef = useRef(null);
  const hasSavedMessages = messages.some((message) => message.id !== welcomeMessage.id);
  const storedMessageCount = messages.filter((message) => message.id !== welcomeMessage.id).length;
  const latestUsage = useMemo(() => {
    return [...messages].reverse().find((message) => message.metadata?.usage)?.metadata?.usage || null;
  }, [messages]);
  const isDraftOverflow = draftTokenReport?.context?.status === 'overflow';

  const canSend = useMemo(
    () =>
      input.trim().length > 0 &&
      !isDraftOverflow &&
      !isDraftPreviewLoading &&
      !isLoading &&
      !isHistoryLoading &&
      !isResetting,
    [input, isDraftOverflow, isDraftPreviewLoading, isHistoryLoading, isLoading, isResetting],
  );

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
          throw new Error(messagesData.error || 'Не удалось загрузить историю диалога.');
        }

        const savedMessages = Array.isArray(messagesData.messages) ? messagesData.messages : [];
        const configuredModelLimit =
          configResponse.ok && Number.isInteger(configData.modelContextWindow)
            ? configData.modelContextWindow
            : DEFAULT_MODEL_CONTEXT_LIMIT;

        if (isMounted) {
          setMessages(savedMessages.length > 0 ? savedMessages : [welcomeMessage]);
          setModelName(configResponse.ok && configData.model ? configData.model : 'gpt-3.5-turbo');
          setModelContextLimit(configuredModelLimit);
        }
      } catch (requestError) {
        const message =
          requestError instanceof Error
            ? requestError.message
            : 'Не удалось загрузить историю диалога.';

        if (isMounted) {
          setErrorDetails(null);
          setError(message);
          setMessages([welcomeMessage]);
        }
      } finally {
        if (isMounted) {
          setIsHistoryLoading(false);
        }
      }
    }

    loadInitialData();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const message = input.trim();

    if (isHistoryLoading || isResetting) {
      setDraftTokenReport(null);
      setDraftPreviewError('');
      setIsDraftPreviewLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setDraftTokenReport(null);
    setDraftPreviewError('');
    setIsDraftPreviewLoading(true);

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/context-preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message }),
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || 'Не удалось предварительно посчитать токены.');
        }

        setDraftTokenReport(data.tokenReport ?? null);
        setDraftPreviewError('');
      } catch (requestError) {
        if (requestError?.name === 'AbortError') {
          return;
        }

        setDraftTokenReport(null);
        setDraftPreviewError('Не удалось заранее проверить лимит контекста.');
      } finally {
        if (!controller.signal.aborted) {
          setIsDraftPreviewLoading(false);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [input, isHistoryLoading, isResetting, storedMessageCount]);

  useLayoutEffect(() => {
    const chatNode = chatScrollRef.current;

    if (!chatNode) {
      return;
    }

    chatNode.scrollTo({
      top: chatNode.scrollHeight,
      behavior: isHistoryLoading ? 'auto' : 'smooth',
    });
  }, [isHistoryLoading, isLoading, messages]);

  async function handleSubmit(event) {
    event.preventDefault();

    const text = input.trim();
    if (!text || isLoading || isHistoryLoading || isResetting) {
      return;
    }

    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
    };

    setMessages((currentMessages) => [...removeWelcomeMessage(currentMessages), userMessage]);
    setInput('');
    setError('');
    setErrorDetails(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: text }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || 'Не удалось получить ответ агента.');
        setErrorDetails(data.details ?? null);
        return;
      }

      setMessages((currentMessages) => [
        ...currentMessages.map((message) =>
          message.id === userMessage.id ? data.userMessage || message : message,
        ),
        data.agentMessage || {
          id: crypto.randomUUID(),
          role: 'agent',
          text: data.answer,
          metadata: {
            model: data.model,
            usage: data.usage,
            settings: data.settings,
          },
        },
      ]);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Произошла неизвестная ошибка.';

      setError(message);
      setErrorDetails(null);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  async function handleReset() {
    if (isLoading || isHistoryLoading || isResetting || !hasSavedMessages) {
      return;
    }

    setError('');
    setErrorDetails(null);
    setIsResetting(true);

    try {
      const response = await fetch('/api/messages', {
        method: 'DELETE',
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Не удалось очистить историю диалога.');
      }

      setMessages([welcomeMessage]);
      setIsResetDialogOpen(false);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось очистить историю диалога.';

      setError(message);
      setErrorDetails(null);
    } finally {
      setIsResetting(false);
      inputRef.current?.focus();
    }
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        component="main"
        sx={{
          background:
            'linear-gradient(118deg, rgba(20, 92, 82, 0.14) 0%, rgba(20, 92, 82, 0.04) 34%, rgba(210, 120, 79, 0.12) 68%, rgba(51, 74, 91, 0.1) 100%), #f4f6f2',
          display: 'flex',
          height: { xs: 'auto', lg: '100vh' },
          minHeight: '100vh',
          overflow: { xs: 'auto', lg: 'hidden' },
          p: { xs: 1, sm: 2, md: 3 },
        }}
      >
        <Box
          component="section"
          aria-label="AI Advent Day 8"
          sx={{
            display: 'grid',
            gap: { xs: 1, md: 1.5 },
            gridTemplateColumns: { xs: '1fr', lg: '360px minmax(0, 1fr)' },
            gridTemplateRows: { xs: 'auto minmax(0, 1fr)', lg: 'minmax(0, 1fr)' },
            height: { xs: 'auto', lg: '100%' },
            m: 'auto',
            maxWidth: 1280,
            minHeight: 0,
            width: '100%',
          }}
        >
          <Paper
            component="aside"
            elevation={0}
            sx={{
              background: 'rgba(255, 255, 255, 0.82)',
              border: '1px solid rgba(24, 32, 31, 0.12)',
              borderRadius: 2,
              boxShadow: '0 24px 70px rgba(24, 32, 31, 0.13)',
              display: 'flex',
              flexDirection: 'column',
              gap: { xs: 1, md: 1.25 },
              height: { xs: 'auto', lg: '100%' },
              minHeight: 0,
              overflow: 'hidden',
              p: { xs: 1.2, sm: 1.5, md: 2 },
            }}
          >
            <Box
              sx={{
                display: 'grid',
                gap: 1,
                gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: '1fr' },
              }}
            >
              <StatusTile
                icon={<StorageRoundedIcon />}
                label="Память"
                value={hasSavedMessages ? 'SQLite активна' : 'Пока пусто'}
              />
              <StatusTile
                icon={<SettingsSuggestRoundedIcon />}
                label="Сообщения"
                value={formatNumber(storedMessageCount)}
              />
            </Box>

            <Panel title="Лимит модели">
              <ModelContextStatus
                draftTokenReport={draftTokenReport}
                latestUsage={latestUsage}
                modelContextLimit={modelContextLimit}
                modelName={modelName}
              />
            </Panel>

            <Panel title="Сессия" sx={{ mt: { lg: 'auto' } }}>
              <SessionStats
                draftTokenReport={draftTokenReport}
                latestUsage={latestUsage}
                messageCount={storedMessageCount}
              />
            </Panel>
          </Paper>

          <Paper
            component="section"
            elevation={0}
            sx={{
              background: '#fffdf8',
              border: '1px solid rgba(24, 32, 31, 0.12)',
              borderRadius: 2,
              boxShadow: '0 24px 70px rgba(24, 32, 31, 0.12)',
              display: 'grid',
              gridTemplateRows: 'auto minmax(0, 1fr) auto',
              minHeight: { xs: '72vh', lg: 0 },
              overflow: 'hidden',
            }}
          >
            <Box
              component="header"
              sx={{
                alignItems: 'center',
                borderBottom: '1px solid rgba(24, 32, 31, 0.1)',
                display: 'flex',
                justifyContent: 'space-between',
                minHeight: 68,
                px: { xs: 1.2, sm: 1.6, md: 2 },
                py: 1,
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  background: '#18201f',
                  borderRadius: 1.5,
                  color: '#fff8ef',
                  display: 'inline-flex',
                  fontSize: '0.86rem',
                  fontWeight: 780,
                  gap: 0.75,
                  lineHeight: 1,
                  px: 1.05,
                  py: 0.85,
                  width: 'fit-content',
                }}
              >
                <MemoryRoundedIcon sx={{ display: 'block', fontSize: 18 }} />
                AI Advent · День 8
              </Box>

              <Tooltip title="Очистить историю">
                <span>
                  <IconButton
                    aria-label="Очистить историю"
                    color="error"
                    disabled={isLoading || isHistoryLoading || isResetting || !hasSavedMessages}
                    onClick={() => setIsResetDialogOpen(true)}
                    sx={{
                      background: 'rgba(185, 71, 71, 0.08)',
                      border: '1px solid rgba(185, 71, 71, 0.18)',
                      color: '#9d3333',
                      height: 40,
                      width: 40,
                      '&:hover': {
                        background: 'rgba(185, 71, 71, 0.14)',
                      },
                    }}
                  >
                    <DeleteOutlineRoundedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>

            <Box
              aria-live="polite"
              ref={chatScrollRef}
              sx={{
                background:
                  'linear-gradient(180deg, rgba(20, 92, 82, 0.045) 0%, rgba(255, 253, 248, 0) 32%), #fffdf8',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                minHeight: 0,
                overflowY: 'auto',
                px: { xs: 1, sm: 1.5, md: 2 },
                py: { xs: 1.2, sm: 1.6 },
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
                  message={{
                    id: 'loading',
                    role: 'agent',
                    text: 'Думаю и вызываю LLM...',
                  }}
                  isLoading
                />
              )}

              {isHistoryLoading && (
                <MessageBubble
                  message={{
                    id: 'history-loading',
                    role: 'agent',
                    text: 'Загружаю сохраненную историю...',
                  }}
                  isLoading
                />
              )}
            </Box>

            <Stack
              component="form"
              onSubmit={handleSubmit}
              spacing={1}
              sx={{
                background: '#ffffff',
                borderTop: '1px solid rgba(24, 32, 31, 0.1)',
                p: { xs: 1, sm: 1.25, md: 1.5 },
              }}
            >
              {error && (
                <Alert severity="error" sx={{ borderRadius: 1.5 }}>
                  <ErrorNotice error={error} details={errorDetails} latestUsage={latestUsage} />
                </Alert>
              )}
              {draftPreviewError && !error && (
                <Alert severity="warning" sx={{ borderRadius: 1.5 }}>
                  {draftPreviewError}
                </Alert>
              )}
              {isDraftOverflow && !error && (
                <Alert severity="warning" sx={{ borderRadius: 1.5 }}>
                  <DraftLimitNotice latestUsage={latestUsage} tokenReport={draftTokenReport} />
                </Alert>
              )}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  disabled={isLoading || isHistoryLoading || isResetting}
                  fullWidth
                  inputRef={inputRef}
                  maxRows={5}
                  minRows={2}
                  multiline
                  onChange={(event) => {
                    setInput(event.target.value);
                    setError('');
                    setErrorDetails(null);
                  }}
                  placeholder="Напишите сообщение агенту"
                  value={input}
                />
                <Button
                  disabled={!canSend}
                  endIcon={
                    isLoading || isDraftPreviewLoading ? (
                      <CircularProgress color="inherit" size={16} />
                    ) : (
                      <SendRoundedIcon />
                    )
                  }
                  sx={{
                    alignSelf: 'stretch',
                    minHeight: { xs: 48, sm: 68 },
                    minWidth: { xs: '100%', sm: 132 },
                    px: 2,
                  }}
                  type="submit"
                  variant="contained"
                >
                  {isLoading ? 'Жду' : isDraftPreviewLoading ? 'Считаю' : isDraftOverflow ? 'Лимит' : 'Отправить'}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </Box>
      </Box>

      <Dialog
        fullWidth
        maxWidth="xs"
        onClose={() => !isResetting && setIsResetDialogOpen(false)}
        open={isResetDialogOpen}
      >
        <DialogTitle>Очистить историю?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Все сохраненные сообщения будут удалены из SQLite. Это действие нельзя отменить.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={isResetting} onClick={() => setIsResetDialogOpen(false)}>
            Отмена
          </Button>
          <Button color="error" disabled={isResetting} onClick={handleReset} variant="contained">
            {isResetting ? 'Очищаю...' : 'Очистить'}
          </Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
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
          ? 'linear-gradient(135deg, #dff1e5 0%, #f8ead8 100%)'
          : 'linear-gradient(180deg, #ffffff 0%, #fbfaf5 100%)',
        border: '1px solid',
        borderColor: isUser ? 'rgba(20, 92, 82, 0.18)' : 'rgba(24, 32, 31, 0.1)',
        borderRadius: 2,
        boxShadow: isUser
          ? '0 16px 36px rgba(20, 92, 82, 0.12)'
          : '0 16px 36px rgba(24, 32, 31, 0.08)',
        maxWidth: { xs: '100%', md: '78%' },
        px: { xs: 1, sm: 1.2 },
        py: { xs: 0.9, sm: 1 },
      }}
    >
      <Stack spacing={0.55}>
        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
          <Box
            aria-hidden="true"
            sx={{
              background: isUser ? '#145c52' : '#d2784f',
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
        {isUser && typeof requestTokens === 'number' && <UserMessageStats tokens={requestTokens} />}
        {!isUser && message.metadata && <MessageStats metadata={message.metadata} />}
      </Stack>
    </Paper>
  );
}

function UserMessageStats({ tokens }) {
  return <MessageMetaLine items={[`сообщение: ${formatNumber(tokens)} ток.`]} />;
}

function MessageStats({ metadata }) {
  const { model, usage } = metadata;
  const tokenText = `потрачено: ${formatNumber(usage?.totalTokens)} ток.`;
  const priceText = formatCost(usage?.cost);

  return <MessageMetaLine items={[model || 'unknown', tokenText, priceText]} />;
}

function MessageMetaLine({ items }) {
  return (
    <Stack
      direction="row"
      spacing={0.6}
      sx={{
        borderTop: '1px solid',
        borderColor: 'rgba(24, 32, 31, 0.1)',
        flexWrap: 'wrap',
        gap: 0.5,
        mt: 0.55,
        pt: 0.6,
      }}
    >
      {items.map((item) => (
        <Typography
          color="text.secondary"
          component="span"
          key={item}
          sx={{
            fontSize: '0.78rem',
            lineHeight: 1.35,
          }}
          variant="caption"
        >
          {item}
        </Typography>
      ))}
    </Stack>
  );
}

function ErrorNotice({ error, details, latestUsage }) {
  const previousInputTokens =
    latestUsage?.tokenReport?.context?.inputTokens ?? latestUsage?.tokenReport?.fullInputTokens;
  const hasOverflowDetails =
    details &&
    typeof details.fullInputTokens === 'number' &&
    typeof details.contextWindow === 'number';

  return (
    <Stack spacing={0.55}>
      <Typography sx={{ fontSize: '0.95rem', lineHeight: 1.45 }}>{error}</Typography>
      {hasOverflowDetails && (
        <>
          <Typography color="text.secondary" sx={{ fontSize: '0.84rem', lineHeight: 1.45 }}>
            {typeof previousInputTokens === 'number'
              ? `${formatNumber(previousInputTokens)} ток. слева - это последний успешный запрос, а не прогноз следующего. `
              : ''}
            При отправке сервер пересчитывает весь следующий input: сохраненная история,
            включая последний ответ агента, плюс новое сообщение.
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: '0.84rem', fontWeight: 720, lineHeight: 1.35 }}>
            Следующий input: {formatNumber(details.fullInputTokens)} ток. · системный prompt:{' '}
            {formatNumber(details.systemInstructionTokens)} ток. · история чата:{' '}
            {formatNumber(details.conversationHistoryTokens)} ток. · новое сообщение:{' '}
            {formatNumber(details.currentRequestTokens)} ток. · лимит: {formatNumber(details.contextWindow)} ток.
          </Typography>
        </>
      )}
    </Stack>
  );
}

function DraftLimitNotice({ latestUsage, tokenReport }) {
  const context = tokenReport?.context;
  const hasDraftText = (tokenReport?.currentRequestTokens ?? 0) > 0;
  const hasConversationHistory = (tokenReport?.conversationHistoryTokens ?? 0) > 0;
  const previousInputTokens =
    latestUsage?.tokenReport?.context?.inputTokens ?? latestUsage?.tokenReport?.fullInputTokens;
  const overflowTokens =
    typeof context?.remainingInputTokens === 'number'
      ? Math.max(Math.abs(context.remainingInputTokens), 0)
      : Math.max((tokenReport?.fullInputTokens ?? 0) - (context?.contextWindow ?? 0), 0);

  return (
    <Stack spacing={0.55}>
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 720, lineHeight: 1.45 }}>
        {hasDraftText
          ? 'Лимит будет превышен до отправки.'
          : hasConversationHistory
            ? 'Сохраненная история уже превышает лимит.'
            : 'Системный prompt уже превышает лимит.'}
      </Typography>
      <Typography color="text.secondary" sx={{ fontSize: '0.84rem', lineHeight: 1.45 }}>
        {hasDraftText ? 'Следующий input уже занимает' : 'Текущий контекст занимает'}{' '}
        {formatNumber(tokenReport?.fullInputTokens)} ток. при лимите {formatNumber(context?.contextWindow)} ток.
        {typeof previousInputTokens === 'number'
          ? ` ${formatNumber(previousInputTokens)} ток. слева - это прошлый успешный расчет.`
          : ''}
      </Typography>
      <Typography color="text.secondary" sx={{ fontSize: '0.84rem', fontWeight: 720, lineHeight: 1.35 }}>
        Системный prompt: {formatNumber(tokenReport?.systemInstructionTokens)} ток. · история чата:{' '}
        {formatNumber(tokenReport?.conversationHistoryTokens)} ток.
        {hasDraftText ? ` · черновик: ${formatNumber(tokenReport?.currentRequestTokens)} ток.` : ''} ·
        превышение: {formatNumber(overflowTokens)} ток.
      </Typography>
    </Stack>
  );
}

function ModelContextStatus({
  draftTokenReport,
  latestUsage,
  modelContextLimit,
  modelName,
}) {
  const activeTokenReport = draftTokenReport ?? latestUsage?.tokenReport;
  const context = activeTokenReport?.context;
  const usedTokens = context?.inputTokens ?? activeTokenReport?.fullInputTokens ?? 0;
  const effectiveLimit = context?.contextWindow ?? modelContextLimit;
  const remainingTokens =
    typeof effectiveLimit === 'number' ? effectiveLimit - usedTokens : null;
  const balanceText =
    remainingTokens === null
      ? '-'
      : remainingTokens < 0
        ? `превышение: ${formatNumber(Math.abs(remainingTokens))} ток.`
        : `до лимита: ${formatNumber(remainingTokens)} ток.`;
  const progressValue =
    typeof effectiveLimit === 'number' && effectiveLimit > 0
      ? Math.min((usedTokens / effectiveLimit) * 100, 100)
      : 0;
  const hasTokenBreakdown = typeof activeTokenReport?.systemInstructionTokens === 'number';
  const usageLabel = draftTokenReport
    ? (draftTokenReport.currentRequestTokens ?? 0) > 0
      ? 'Следующий запрос'
      : 'Текущий контекст'
    : 'Последний запрос';

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={0.75} sx={{ justifyContent: 'space-between' }}>
        <Typography color="text.secondary" variant="caption">
          Модель
        </Typography>
        <Typography color="text.secondary" variant="caption">
          {modelName}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={0.75} sx={{ justifyContent: 'space-between' }}>
        <Typography color="text.secondary" variant="caption">
          Окно контекста
        </Typography>
        <Typography color="text.secondary" variant="caption">
          {formatNumber(effectiveLimit)} ток.
        </Typography>
      </Stack>
      <LinearProgress
        color={context?.status === 'overflow' ? 'error' : 'primary'}
        sx={{
          bgcolor: 'rgba(24, 32, 31, 0.08)',
          borderRadius: 1,
          height: 8,
          '& .MuiLinearProgress-bar': {
            background: 'linear-gradient(90deg, #145c52 0%, #d2784f 100%)',
            borderRadius: 1,
          },
        }}
        value={progressValue}
        variant="determinate"
      />
      <Typography color="text.secondary" variant="caption">
        {usageLabel}: {formatNumber(usedTokens)} ток. · {balanceText}
      </Typography>
      {hasTokenBreakdown && (
        <Stack spacing={0.35} sx={{ pt: 0.15 }}>
          <MetricLine
            label="Системный prompt"
            value={`${formatNumber(activeTokenReport.systemInstructionTokens)} ток.`}
          />
          <MetricLine
            label="История чата"
            value={`${formatNumber(activeTokenReport.conversationHistoryTokens)} ток.`}
          />
          {(activeTokenReport.currentRequestTokens ?? 0) > 0 && (
            <MetricLine
              label="Черновик"
              value={`${formatNumber(activeTokenReport.currentRequestTokens)} ток.`}
            />
          )}
        </Stack>
      )}
    </Stack>
  );
}

function SessionStats({ draftTokenReport, latestUsage, messageCount }) {
  const activeTokenReport = draftTokenReport ?? latestUsage?.tokenReport;
  const context = activeTokenReport?.context;
  const usedTokens = context?.inputTokens ?? activeTokenReport?.fullInputTokens ?? 0;
  const effectiveLimit = context?.contextWindow;
  const remainingTokens =
    typeof effectiveLimit === 'number' ? effectiveLimit - usedTokens : null;
  const spentCost = {
    estimatedUsd: latestUsage?.cumulative?.estimatedUsd,
    currency: latestUsage?.cost?.currency || 'USD',
  };
  const spentTokens = latestUsage?.cumulative?.totalTokens;
  const hasOnlySystemPrompt =
    (activeTokenReport?.systemInstructionTokens ?? 0) > 0 &&
    (activeTokenReport?.conversationHistoryTokens ?? 0) === 0 &&
    (activeTokenReport?.currentRequestTokens ?? 0) === 0;
  const usageLabel = hasOnlySystemPrompt
    ? 'Системный prompt'
    : draftTokenReport
    ? (draftTokenReport.currentRequestTokens ?? 0) > 0
      ? 'Следующий запрос'
      : 'Текущий контекст'
    : 'Последний запрос';

  return (
    <Stack spacing={0.75}>
      <MetricLine label="Сообщения" value={formatNumber(messageCount)} />
      <MetricLine
        label={usageLabel}
        value={`${formatNumber(usedTokens)} / ${effectiveLimit ? formatNumber(effectiveLimit) : '-'} ток.`}
      />
      <MetricLine
        label={remainingTokens !== null && remainingTokens < 0 ? 'Превышение' : 'До лимита'}
        value={
          remainingTokens === null
            ? '-'
            : `${formatNumber(Math.abs(remainingTokens))} ток.`
        }
      />
      <MetricLine label="Потрачено" value={`${formatNumber(spentTokens)} ток. · ${formatCost(spentCost)}`} />
    </Stack>
  );
}

function Panel({ children, title, sx }) {
  return (
    <Box
      sx={{
        background: 'rgba(255, 253, 248, 0.74)',
        border: '1px solid rgba(24, 32, 31, 0.1)',
        borderRadius: 2,
        p: 1.2,
        ...sx,
      }}
    >
      <Typography color="text.secondary" fontWeight={780} sx={{ mb: 1 }} variant="caption">
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function StatusTile({ icon, label, value }) {
  return (
    <Box
      sx={{
        alignItems: 'center',
        background: '#fffdf8',
        border: '1px solid rgba(24, 32, 31, 0.1)',
        borderRadius: 2,
        display: 'grid',
        gap: 0.75,
        gridTemplateColumns: '40px minmax(0, 1fr)',
        minHeight: 64,
        p: 1,
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          background: 'rgba(20, 92, 82, 0.1)',
          borderRadius: 1.5,
          color: '#145c52',
          display: 'flex',
          height: 40,
          justifyContent: 'center',
          width: 40,
          '& svg': {
            display: 'block',
            fontSize: 21,
          },
        }}
      >
        {icon}
      </Box>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          minWidth: 0,
        }}
      >
        <Typography color="text.secondary" variant="caption">
          {label}
        </Typography>
        <Typography
          sx={{
            fontSize: '0.98rem',
            fontWeight: 760,
            lineHeight: 1.2,
            overflowWrap: 'anywhere',
          }}
        >
          {value}
        </Typography>
      </Box>
    </Box>
  );
}

function MetricLine({ label, value }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: 'baseline',
        justifyContent: 'space-between',
      }}
    >
      <Typography color="text.secondary" variant="caption">
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: '0.9rem',
          fontWeight: 740,
          lineHeight: 1.35,
          textAlign: 'right',
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function formatNumber(value) {
  if (typeof value !== 'number') {
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

const rootElement = document.getElementById('root');
const appRoot = rootElement.reactRoot ?? createRoot(rootElement);
rootElement.reactRoot = appRoot;
appRoot.render(<App />);
