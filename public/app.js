const SETTINGS_KEY = 'universal_ping_settings_v1';

let appState = {
  monitors: [],
  settings: {
    theme: 'dark',
    mode: 'server',
    backendUrl: window.location.origin,
    timeout: 10
  }
};

const monitorsGrid = document.getElementById('monitors-grid');
const addForm = document.getElementById('add-monitor-form');
const settingsModal = document.getElementById('settings-modal');
const detailsModal = document.getElementById('details-modal');

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  fetchMonitors();
  setupEventListeners();
  setInterval(fetchMonitors, 10000);
});

function loadSettings() {
  const savedSettings = localStorage.getItem(SETTINGS_KEY);
  if (savedSettings) {
    appState.settings = { ...appState.settings, ...JSON.parse(savedSettings) };
  }
  if (!appState.settings.backendUrl) {
    appState.settings.backendUrl = window.location.origin;
  }
  
  document.body.setAttribute('data-theme', appState.settings.theme);
  document.getElementById('setting-theme').value = appState.settings.theme;
  document.getElementById('setting-mode').value = appState.settings.mode;
  document.getElementById('setting-backend-url').value = appState.settings.backendUrl;
  document.getElementById('setting-timeout').value = appState.settings.timeout;
}

function saveSettings() {
  appState.settings.theme = document.getElementById('setting-theme').value;
  appState.settings.mode = document.getElementById('setting-mode').value;
  appState.settings.backendUrl = document.getElementById('setting-backend-url').value || window.location.origin;
  appState.settings.timeout = parseInt(document.getElementById('setting-timeout').value) || 10;

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(appState.settings));
  loadSettings();
  settingsModal.classList.remove('active');
  fetchMonitors();
}

async function fetchMonitors() {
  try {
    const res = await fetch(`${appState.settings.backendUrl}/api/monitors`);
    appState.monitors = await res.json();
    renderMonitors();
  } catch (e) {
    console.error('Ошибка получения данных с сервера:', e);
  }
}

function renderMonitors() {
  monitorsGrid.innerHTML = '';
  if (appState.monitors.length === 0) {
    monitorsGrid.innerHTML = `<p style="grid-column: 1/-1; color: var(--text-muted); text-align: center; padding: 30px;">Мониторы отсутствуют. Добавьте первый URL выше :)</p>`;
    updateDashboardStats();
    return;
  }

  appState.monitors.forEach(mon => {
    const card = document.createElement('div');
    card.className = 'monitor-card';

    const statusMap = {
      ONLINE: { text: '🟢 ONLINE', class: 'status-online' },
      OFFLINE: { text: '🔴 OFFLINE', class: 'status-offline' },
      CHECKING: { text: '🟡 CHECKING', class: 'status-checking' },
      PAUSED: { text: '⚪ PAUSED', class: 'status-paused' }
    };

    const statusInfo = statusMap[mon.status] || statusMap.PAUSED;
    const lastCheckTime = mon.lastCheck ? new Date(mon.lastCheck).toLocaleTimeString() : 'Никогда';

    card.innerHTML = `
      <div>
        <div class="card-top">
          <div class="monitor-name">${escapeHtml(mon.name)}</div>
          <span class="status-badge ${statusInfo.class}">${statusInfo.text}</span>
        </div>
        <a class="monitor-url" href="${escapeHtml(mon.url)}" target="_blank" rel="noopener">${escapeHtml(mon.url)}</a>
        <div class="monitor-details">
          <span><strong>Response:</strong> ${mon.responseTime !== null ? mon.responseTime + ' ms' : '--'}</span>
          <span><strong>Last check:</strong> ${lastCheckTime}</span>
          <span><strong>Interval:</strong> ${mon.interval} мин</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-small btn-secondary" onclick="checkMonitorNow('${mon.id}')">Проверить</button>
        <button class="btn btn-small btn-secondary" onclick="openDetails('${mon.id}')">Детали</button>
        <button class="btn btn-small btn-secondary" style="color:var(--offline-color);" onclick="deleteMonitor('${mon.id}')">Удалить</button>
      </div>
    `;
    monitorsGrid.appendChild(card);
  });

  updateDashboardStats();
}

function updateDashboardStats() {
  const total = appState.monitors.length;
  const online = appState.monitors.filter(m => m.status === 'ONLINE').length;
  const offline = appState.monitors.filter(m => m.status === 'OFFLINE').length;
  
  const validTimes = appState.monitors.map(m => m.responseTime).filter(t => t !== null && t > 0);
  const avgTime = validTimes.length ? Math.round(validTimes.reduce((a, b) => a + b, 0) / validTimes.length) : 0;
  const uptime = total > 0 ? ((online / total) * 100).toFixed(1) : 100;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-online').textContent = online;
  document.getElementById('stat-offline').textContent = offline;
  document.getElementById('stat-avg-time').textContent = avgTime + ' ms';
  document.getElementById('stat-uptime').textContent = uptime + '%';
}

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const urlInput = document.getElementById('monitor-url').value.trim();
  const nameInput = document.getElementById('monitor-name').value.trim();
  const intervalInput = parseInt(document.getElementById('monitor-interval').value);

  try {
    const res = await fetch(`${appState.settings.backendUrl}/api/monitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameInput, url: urlInput, interval: intervalInput })
    });
    
    if (res.ok) {
      const newMon = await res.json();
      await fetch(`${appState.settings.backendUrl}/api/monitors/${newMon.id}/check`, { method: 'POST' });
      fetchMonitors();
      addForm.reset();
    } else {
      const err = await res.json();
      alert(err.error || 'Ошибка при добавлении монитора');
    }
  } catch (err) {
    alert('Не удалось связаться с сервером');
  }
});

window.checkMonitorNow = async (id) => {
  await fetch(`${appState.settings.backendUrl}/api/monitors/${id}/check`, { method: 'POST' });
  fetchMonitors();
};

window.deleteMonitor = async (id) => {
  if (confirm('Удалить этот монитор?')) {
    await fetch(`${appState.settings.backendUrl}/api/monitors/${id}`, { method: 'DELETE' });
    fetchMonitors();
  }
};

window.openDetails = (id) => {
  const mon = appState.monitors.find(m => m.id === id);
  if (!mon) return;

  document.getElementById('modal-title').textContent = mon.name;
  document.getElementById('modal-url').textContent = mon.url;
  document.getElementById('modal-url').href = mon.url;
  document.getElementById('modal-status').textContent = mon.status;
  document.getElementById('modal-http-code').textContent = mon.history[0]?.httpCode || '--';
  document.getElementById('modal-response-time').textContent = mon.responseTime ? mon.responseTime + ' ms' : '--';
  document.getElementById('modal-last-success').textContent = mon.lastSuccess ? new Date(mon.lastSuccess).toLocaleString() : 'Никогда';

  const successes = mon.history.filter(h => h.status === 'ONLINE').length;
  const errors = mon.history.filter(h => h.status === 'OFFLINE').length;
  document.getElementById('modal-success-count').textContent = successes;
  document.getElementById('modal-error-count').textContent = errors;
  
  const totalChecks = successes + errors;
  const uptime = totalChecks > 0 ? ((successes / totalChecks) * 100).toFixed(1) : 100;
  document.getElementById('modal-uptime').textContent = uptime + '%';

  const historyList = document.getElementById('history-list');
  historyList.innerHTML = mon.history.map(h => `
    <li class="history-item">
      <span>${h.status === 'ONLINE' ? '🟢' : '🔴'} ${new Date(h.timestamp).toLocaleTimeString()}</span>
      <span>${h.responseTime ? h.responseTime + ' ms' : '--'}</span>
      <span>${h.httpCode || ''}</span>
    </li>
  `).join('');

  renderChart(mon.history);
  detailsModal.classList.add('active');
};

function renderChart(history) {
  const svg = document.getElementById('response-chart');
  svg.innerHTML = '';
  if (!history || history.length === 0) return;

  const points = [...history].reverse().filter(h => h.responseTime !== null);
  if (points.length < 2) return;

  const maxVal = Math.max(...points.map(p => p.responseTime), 500);
  const width = 500;
  const height = 150;
  const stepX = width / (points.length - 1);

  const polylinePoints = points.map((p, idx) => {
    const x = idx * stepX;
    const y = height - (p.responseTime / maxVal) * (height - 20) - 10;
    return `${x},${y}`;
  }).join(' ');

  svg.innerHTML = `
    <polyline fill="none" stroke="var(--primary-color)" stroke-width="3" points="${polylinePoints}" />
  `;
}

function setupEventListeners() {
  document.getElementById('btn-open-settings').onclick = () => settingsModal.classList.add('active');
  document.getElementById('close-settings').onclick = () => settingsModal.classList.remove('active');
  document.getElementById('close-details').onclick = () => detailsModal.classList.remove('active');
  document.getElementById('btn-save-settings').onclick = saveSettings;
  document.getElementById('btn-check-all').onclick = () => {
    appState.monitors.forEach(m => window.checkMonitorNow(m.id));
  };
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}

