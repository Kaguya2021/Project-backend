require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use(helmet());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

// In-Memory Storage Fallback (если PostgreSQL не подключен)
let monitors = [];

// SSRF Validation Helper
function isUrlSafe(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const hostname = parsed.hostname.toLowerCase();

    // Запрет локальных диапазонов
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      hostname === '169.254.169.254'
    ) {
      return false;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', mode: 'Server Mode', timestamp: new Date() });
});

app.get('/api/monitors', (req, res) => {
  res.json(monitors);
});

app.post('/api/monitors', (req, res) => {
  const { name, url, interval } = req.body;

  if (!url || !isUrlSafe(url)) {
    return res.status(400).json({ error: 'Недопустимый или небезопасный URL (SSRF Protection)' });
  }

  const newMon = {
    id: 'mon_' + Date.now(),
    name: name || new URL(url).hostname,
    url,
    interval: parseInt(interval) || 5,
    status: 'CHECKING',
    responseTime: null,
    lastCheck: null,
    lastSuccess: null,
    history: []
  };

  monitors.push(newMon);
  res.status(201).json(newMon);
});

app.post('/api/monitors/:id/check', async (req, res) => {
  const mon = monitors.find(m => m.id === req.params.id);
  if (!mon) return res.status(404).json({ error: 'Монитор не найден' });

  if (!isUrlSafe(mon.url)) {
    return res.status(400).json({ error: 'Заблокировано SSRF защитой' });
  }

  const startTime = Date.now();
  try {
    const response = await axios.get(mon.url, { timeout: 10000, headers: { 'User-Agent': 'UniversalPing-Bot/1.0' } });
    const responseTime = Date.now() - startTime;

    mon.status = 'ONLINE';
    mon.responseTime = responseTime;
    mon.lastCheck = new Date().toISOString();
    mon.lastSuccess = mon.lastCheck;

    mon.history.unshift({
      timestamp: mon.lastCheck,
      status: 'ONLINE',
      responseTime,
      httpCode: response.status
    });

    res.json({ success: true, responseTime, httpCode: response.status });
  } catch (err) {
    const responseTime = Date.now() - startTime;
    const httpCode = err.response ? err.response.status : (err.code === 'ECONNABORTED' ? 'Timeout' : 'ERR');

    mon.status = 'OFFLINE';
    mon.responseTime = responseTime;
    mon.lastCheck = new Date().toISOString();

    mon.history.unshift({
      timestamp: mon.lastCheck,
      status: 'OFFLINE',
      responseTime,
      httpCode
    });

    res.json({ success: false, responseTime, httpCode });
  }
});

app.delete('/api/monitors/:id', (req, res) => {
  monitors = monitors.filter(m => m.id !== req.params.id);
  res.json({ success: true });
});

// Background Worker for Auto Ping
setInterval(() => {
  const now = Date.now();
  monitors.forEach(async (mon) => {
    if (mon.status !== 'PAUSED') {
      const last = mon.lastCheck ? new Date(mon.lastCheck).getTime() : 0;
      if (now - last >= mon.interval * 60 * 1000) {
        try {
          await axios.post(`http://localhost:${PORT}/api/monitors/${mon.id}/check`);
        } catch (e) { /* ignore */ }
      }
    }
  });
}, 15000);

app.listen(PORT, () => {
  console.log(`Universal Ping Server running on port ${PORT}`);
});
