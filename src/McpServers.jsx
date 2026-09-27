import React, { useEffect, useState } from 'react';
import { Alert, Box, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material';

export const serverColors = { altegio: 'primary', analytics: 'secondary', currency: 'warning', files: 'info' };

export default function McpServers({ refreshKey, busy }) {
  const [servers, setServers] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (busy) return;
    fetch('/api/mcp/servers').then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось получить MCP-серверы.');
      setServers(data.servers); setError('');
    }).catch(e => setError(e.message));
  }, [refreshKey, busy]);
  return <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, flexShrink: 0 }}>
    <Typography component="h2" variant="h6" sx={{ mb: 1.5 }}>MCP-серверы</Typography>
    {!servers && !error && <CircularProgress size={20} aria-label="Загрузка MCP-серверов" />}
    {error && <Alert severity="error">{error}</Alert>}
    <Stack spacing={1.5}>
      {servers?.map(server => <Box key={server.name}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <Chip size="small" label={server.name} color={serverColors[server.name] ?? 'default'} />
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{server.description}</Typography>
          <Chip size="small" variant="outlined" label={server.connected ? 'подключён' : 'недоступен'} color={server.connected ? 'success' : 'error'} />
        </Stack>
        {server.error && <Typography variant="caption" color="error">{server.error}</Typography>}
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
          {server.tools.map(tool => <Box key={tool} component="code" sx={{ fontSize: 12, px: 0.75, py: 0.25, borderRadius: 1, bgcolor: 'action.hover' }}>{tool}</Box>)}
        </Stack>
      </Box>)}
    </Stack>
  </Paper>;
}
