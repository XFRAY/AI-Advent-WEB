import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
  createTheme,
} from '@mui/material';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const welcomeMessage = {
  id: 'welcome-day-7',
  role: 'agent',
  text: 'Привет! Я web-агент Дня 7. Я сохраняю историю диалога и восстановлю ее после перезапуска.',
};

const theme = createTheme({
  palette: {
    background: {
      default: '#f8faf7',
      paper: '#ffffff',
    },
    primary: {
      main: '#326b4f',
    },
    text: {
      primary: '#18211d',
      secondary: '#5d6d64',
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 12,
    h1: {
      fontSize: '1.18rem',
      fontWeight: 700,
      letterSpacing: 0,
      lineHeight: 1.15,
    },
    body2: {
      fontSize: '0.78rem',
      lineHeight: 1.45,
    },
    caption: {
      fontSize: '0.62rem',
      letterSpacing: 0,
      lineHeight: 1.25,
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
          minHeight: 30,
          textTransform: 'none',
        },
      },
    },
    MuiChip: {
      defaultProps: {
        size: 'small',
      },
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontSize: '0.68rem',
          height: 26,
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
    },
  },
});

function removeWelcomeMessage(messages) {
  return messages.filter((message) => message.id !== welcomeMessage.id);
}

function App() {
  const [messages, setMessages] = useState([welcomeMessage]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isResetting, setIsResetting] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const hasSavedMessages = messages.some((message) => message.id !== welcomeMessage.id);

  const canSend = useMemo(
    () => input.trim().length > 0 && !isLoading && !isHistoryLoading && !isResetting,
    [input, isHistoryLoading, isLoading, isResetting],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadMessages() {
      try {
        const response = await fetch('/api/messages');
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || 'Не удалось загрузить историю диалога.');
        }

        const savedMessages = Array.isArray(data.messages) ? data.messages : [];

        if (isMounted) {
          setMessages(savedMessages.length > 0 ? savedMessages : [welcomeMessage]);
        }
      } catch (requestError) {
        const message =
          requestError instanceof Error
            ? requestError.message
            : 'Не удалось загрузить историю диалога.';

        if (isMounted) {
          setError(message);
          setMessages([welcomeMessage]);
        }
      } finally {
        if (isMounted) {
          setIsHistoryLoading(false);
        }
      }
    }

    loadMessages();

    return () => {
      isMounted = false;
    };
  }, []);

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
        throw new Error(data.error || 'Не удалось получить ответ агента.');
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
          bgcolor: 'background.default',
          display: 'flex',
          minHeight: '100vh',
          p: { xs: 1, sm: 2 },
        }}
      >
        <Paper
          component="section"
          elevation={0}
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            m: 'auto',
            maxWidth: 760,
            minHeight: { xs: 'calc(100vh - 16px)', sm: 'min(620px, calc(100vh - 32px))' },
            p: { xs: 1, sm: 1.25 },
            width: '100%',
          }}
        >
          <Stack
            component="header"
            direction={{ xs: 'column', sm: 'row' }}
            spacing={0.75}
            sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography color="text.secondary" fontWeight={700} variant="caption">
                AI Advent · День 7
              </Typography>
              <Typography component="h1" id="page-title" variant="h1">
                Агент с памятью
              </Typography>
            </Box>

            <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
              <Chip icon={<StorageRoundedIcon />} label="SQLite memory" variant="outlined" />
              <Tooltip title="Очистить историю">
                <span>
                  <IconButton
                    aria-label="Очистить историю"
                    color="error"
                    disabled={isLoading || isHistoryLoading || isResetting || !hasSavedMessages}
                    onClick={() => setIsResetDialogOpen(true)}
                  >
                    <DeleteOutlineRoundedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Stack>

          <Box
            aria-live="polite"
            sx={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              gap: 0.75,
              overflowY: 'auto',
              p: 0.25,
            }}
          >
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
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

          {error && (
            <Alert severity="error" sx={{ py: 0.25 }}>
              {error}
            </Alert>
          )}

          <Stack
            component="form"
            direction={{ xs: 'column', sm: 'row' }}
            onSubmit={handleSubmit}
            spacing={0.75}
          >
            <TextField
              disabled={isLoading || isHistoryLoading || isResetting}
              fullWidth
              inputRef={inputRef}
              maxRows={4}
              minRows={2}
              multiline
              onChange={(event) => setInput(event.target.value)}
              placeholder="Например: запомни, что мой любимый цвет зеленый"
              value={input}
            />
            <Button
              disabled={!canSend}
              endIcon={isLoading ? <CircularProgress color="inherit" size={14} /> : <SendRoundedIcon />}
              sx={{ alignSelf: { xs: 'stretch', sm: 'flex-end' }, minWidth: 104 }}
              type="submit"
              variant="contained"
            >
              {isLoading ? 'Жду' : 'Отправить'}
            </Button>
          </Stack>
        </Paper>
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
            {isResetting ? 'Очищаю...' : 'Reset'}
          </Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}

function MessageBubble({ message, isLoading = false }) {
  const isUser = message.role === 'user';

  return (
    <Paper
      component="article"
      elevation={0}
      sx={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        bgcolor: isUser ? '#e7f3ec' : '#ffffff',
        border: '1px solid',
        borderColor: isUser ? 'rgba(50, 107, 79, 0.22)' : 'divider',
        maxWidth: { xs: '100%', sm: '72%' },
        px: 0.9,
        py: 0.65,
      }}
    >
      <Stack spacing={0.25}>
        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
          <Typography color="text.secondary" fontWeight={700} variant="caption">
            {isUser ? 'Вы' : 'Агент'}
          </Typography>
          {isLoading && <CircularProgress color="inherit" size={10} />}
        </Stack>
        <Typography sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }} variant="body2">
          {message.text}
        </Typography>
        {message.metadata && <MessageStats metadata={message.metadata} />}
      </Stack>
    </Paper>
  );
}

function MessageStats({ metadata }) {
  const { model, settings, usage } = metadata;
  const stats = [
    ['Model', model || 'unknown'],
    ['Temp', formatTemperature(settings?.temperature)],
    ['In', `${formatNumber(usage?.inputTokens)} ток.`],
    ['Out', `${formatNumber(usage?.outputTokens)} ток.`],
    ['Reasoning', `${formatNumber(usage?.reasoningTokens)} ток.`],
    ['Total', `${formatNumber(usage?.totalTokens)} ток.`],
    ['Cost', formatCost(usage?.cost)],
  ];

  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{
        borderTop: '1px solid',
        borderColor: 'divider',
        flexWrap: 'wrap',
        gap: 0.5,
        mt: 0.45,
        pt: 0.45,
      }}
    >
      {stats.map(([label, value]) => (
        <Typography
          color="text.secondary"
          component="span"
          key={label}
          sx={{
            bgcolor: 'rgba(24, 33, 29, 0.04)',
            borderRadius: 1,
            fontSize: '0.58rem',
            lineHeight: 1.35,
            px: 0.45,
            py: 0.1,
          }}
          variant="caption"
        >
          {label}: {value}
        </Typography>
      ))}
    </Stack>
  );
}

function formatNumber(value) {
  if (typeof value !== 'number') {
    return '0';
  }

  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatTemperature(value) {
  return typeof value === 'number' ? value : 'default';
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

createRoot(document.getElementById('root')).render(<App />);
