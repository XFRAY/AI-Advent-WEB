import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';

async function authRequest(method = 'GET', body, path = '/api/altegio/auth') {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Ошибка авторизации.');
  return data;
}
export default function AltegioLogin({ busy, onBusyChange, onSessionChange }) {
  const [status, setStatus] = useState(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => { authRequest().then(setStatus).catch(e => setError(e.message)); }, []);
  async function submit(event) {
    event.preventDefault();
    setPending(true); onBusyChange(true); setError('');
    try {
      setStatus(await authRequest('POST', { login, password }));
      setLogin(''); onSessionChange();
    } catch (e) { setError(e.message); }
    finally { setPassword(''); setPending(false); onBusyChange(false); }
  }
  async function logout() {
    setPending(true); onBusyChange(true); setError('');
    try { setStatus(await authRequest('DELETE')); onSessionChange(); }
    catch (e) { setError(e.message); }
    finally { setPending(false); onBusyChange(false); }
  }
  async function changeLocation(locationId) {
    setPending(true); onBusyChange(true); setError('');
    try { setStatus(await authRequest('POST', { locationId }, '/api/altegio/location')); onSessionChange(); }
    catch (e) { setError(e.message); }
    finally { setPending(false); onBusyChange(false); }
  }
  async function refreshLocations() {
    setPending(true); onBusyChange(true); setError('');
    try {
      const next = await authRequest('POST', {}, '/api/altegio/locations/refresh');
      if (next.locationId !== status.locationId) onSessionChange();
      setStatus(next);
    } catch (e) { setError(e.message); }
    finally { setPending(false); onBusyChange(false); }
  }
  return <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, flexShrink: 0, maxHeight: '36%', overflowY: 'auto', overscrollBehavior: 'contain' }}>
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2 }}>
      <Typography component="h2" variant="h6">Подключение Altegio</Typography>
      <Chip size="small" label={status?.authenticated ? 'Авторизован' : 'Не подключено'} color={status?.authenticated ? 'success' : 'default'} />
    </Stack>
    {!status && !error && <CircularProgress size={20} aria-label="Проверка подключения" />}
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {status && !status.partnerConfigured && <Alert severity="warning" sx={{ mb: 2 }}>Для входа добавьте ALTEGIO_PARTNER_TOKEN в .env сервера и перезапустите приложение.</Alert>}
    {status?.authenticated ? <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
        <Typography color="text.secondary">Выберите филиал для запросов к агенту.</Typography>
        <Button onClick={logout} disabled={busy || pending} variant="outlined">Выйти</Button>
      </Stack>
      {status.locationsError && <Alert severity="error">{status.locationsError}</Alert>}
      {status.locations?.length === 1 && <Typography>Филиал: <strong>{status.locations[0].title}</strong>{status.locations[0].address ? ` · ${status.locations[0].address}` : ''}</Typography>}
      {status.locations?.length > 1 && <TextField select fullWidth label="Филиал" value={status.locationId || ''} onChange={event => changeLocation(event.target.value)} disabled={busy || pending} helperText="При смене филиала история чата очищается.">
        <MenuItem value="" disabled>Выберите филиал</MenuItem>
        {status.locations.map(location => <MenuItem key={location.id} value={location.id}>{location.title}{location.address ? ` · ${location.address}` : ''} (#{location.id})</MenuItem>)}
      </TextField>}
      {status.locationsLoaded && !status.locations?.length && <Alert severity="info">У аккаунта нет доступных филиалов.</Alert>}
      <Button onClick={refreshLocations} disabled={busy || pending} sx={{ alignSelf: 'flex-start' }}>{pending ? 'Загрузка…' : 'Обновить список филиалов'}</Button>
    </Stack> : <Box component="form" onSubmit={submit}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2 }}>
        <TextField fullWidth required label="Логин Altegio" autoComplete="username" value={login} onChange={e => setLogin(e.target.value)} disabled={busy || pending} slotProps={{ htmlInput: { maxLength: 320 } }} />
        <TextField fullWidth required label="Пароль" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy || pending} slotProps={{ htmlInput: { maxLength: 1024 } }} />
        <Button type="submit" variant="contained" disabled={busy || pending || !status?.partnerConfigured || !login.trim() || !password} sx={{ minWidth: 110 }}>{pending ? <CircularProgress size={20} color="inherit" /> : 'Войти'}</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>Вход через аккаунт Altegio. Пароль не сохраняется; подключение действует до выхода или перезапуска сервера.</Typography>
    </Box>}
  </Paper>;
}
