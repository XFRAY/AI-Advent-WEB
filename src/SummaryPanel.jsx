import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material';
async function request(path, body) {
  const response = await fetch(`/api/summary/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось загрузить сводки.');
  return data;
}
const states = { scheduled: 'По расписанию', paused: 'Приостановлено', running: 'Собираю данные', waiting_connection: 'Нужно подключение' };
const time = value => value ? new Date(value).toLocaleString() : '—';
export default function SummaryPanel({ busy, onBusyChange }) {
  const [status, setStatus] = useState(null), [runs, setRuns] = useState([]);
  const [interval, setIntervalValue] = useState(60);
  const [error, setError] = useState(''), [working, setWorking] = useState(false);
  const lastSettings = useRef('');
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (busy || working || document.hidden) return;
      try {
        // Sequential requests share the backend's single command gate.
        const next = await request('status');
        const history = await request('results');
        if (cancelled) return;
        setStatus(next); setRuns(history.runs);
        const settingsKey = JSON.stringify([next.locationId, next.schedule?.locationId, next.schedule?.intervalMinutes]);
        if (lastSettings.current !== settingsKey) {
          const current = next.schedule?.locationId === next.locationId ? next.schedule : null;
          setIntervalValue(current?.intervalMinutes ?? 60);
          lastSettings.current = settingsKey;
        }
        setError('');
      } catch (e) { if (!cancelled) setError(e.message); }
    };
    refresh(); const timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [busy, working]);
  async function action(path) {
    setWorking(true); onBusyChange(true); setError('');
    try {
      const args = path === 'schedule' ? { intervalMinutes: Number(interval) } : {};
      setStatus(await request(path, args));
      const history = await request('results'); setRuns(history.runs);
    } catch (e) { setError(e.message); }
    finally { setWorking(false); onBusyChange(false); }
  }
  const latest = status?.latest;
  const disabled = busy || working;
  return <Paper variant="outlined" sx={{ p: 2.5, flexShrink: 0, borderRadius: 3 }}>
    <Stack spacing={2}>
      <Box>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.75 }}>
          <Typography component="h2" variant="h6" fontWeight={700}>Деньги за сегодня</Typography>
          <Chip size="small" color={status?.state === 'scheduled' ? 'success' : 'default'} variant="outlined" label={working ? 'Собираю…' : states[status?.state] || 'Загрузка…'} />
        </Stack>
        <Typography variant="body2" color="text.secondary">{latest?.locationTitle || status?.schedule?.title || 'Выберите филиал в Altegio'}</Typography>
      </Box>
      <Box sx={{ bgcolor: '#f0f6f3', borderRadius: 2.5, p: 2 }}>
        <Typography variant="caption" color="text.secondary">{latest ? `Итог за ${latest.date}` : 'Движение денег за день'}</Typography>
        <Typography sx={{ fontSize: 32, fontWeight: 750, color: 'primary.main', lineHeight: 1.4, overflowWrap: 'anywhere' }}>{latest?.net ?? '—'} <Box component="span" sx={{ fontSize: 15, fontWeight: 500 }}>{latest?.currency || ''}</Box></Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mt: 1.5 }}>
          {[['Поступления', latest?.incoming], ['Списания', latest?.outgoing]].map(([label, amount]) => <Box key={label}>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
            <Typography fontWeight={650} sx={{ overflowWrap: 'anywhere' }}>{amount ?? '—'}</Typography>
          </Box>)}
        </Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>{latest ? `${latest.transactionCount} операций · ${time(latest.collectedAt)}${latest.currency ? '' : ' · Валюта не указана'}` : 'Первый результат появится после сбора'}</Typography>
      </Box>
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Автоматический сбор</Typography>
        <Stack direction="row" spacing={1}>
          <TextField size="small" type="number" label="Каждые, мин" value={interval} onChange={e => setIntervalValue(e.target.value)} disabled={disabled} sx={{ width: 130, flexShrink: 0 }} slotProps={{ htmlInput: { min: 1, max: 1440 } }} />
          <Button fullWidth variant="contained" disableElevation onClick={() => action('schedule')} disabled={disabled || !Number.isInteger(Number(interval)) || Number(interval) < 1 || Number(interval) > 1440} sx={{ textTransform: 'none', borderRadius: 2 }}>{status?.schedule?.enabled ? 'Обновить' : 'Включить'}</Button>
          {status?.schedule?.enabled && <Button variant="outlined" onClick={() => action('pause')} disabled={disabled} sx={{ textTransform: 'none', borderRadius: 2 }}>Пауза</Button>}
        </Stack>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>Следующий сбор: {status?.state === 'scheduled' ? time(status.schedule.nextRunAt) : '—'}</Typography>
      </Box>
      <Button fullWidth variant="outlined" onClick={() => action('run')} disabled={disabled} sx={{ textTransform: 'none', borderRadius: 2 }}>Собрать сейчас</Button>
      {(error || status?.error) && <Alert severity="warning">{error || status.error}</Alert>}
      <Box component="details" sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.5 }}>
        <Box component="summary" sx={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>История запусков · {runs.length}</Box>
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          {!runs.length && <Typography variant="body2" color="text.secondary">Пока нет запусков.</Typography>}
          {runs.map(run => <Box key={run.id} sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>
            <Typography variant="caption" color="text.secondary">{time(run.startedAt)} · {run.summary?.locationTitle || `Филиал ${run.locationId || 'не выбран'}`}</Typography>
            <Typography variant="body2" color={run.status === 'error' ? 'error' : 'text.primary'}>{run.summary?.text || run.error || 'Сбор выполняется…'}</Typography>
          </Box>)}
        </Stack>
      </Box>
      <Typography variant="caption" color="text.secondary">Снимки показывают итог дня и не суммируются. Фоновый сбор работает, пока сервер запущен и компьютер не спит.</Typography>
    </Stack>
  </Paper>;
}
