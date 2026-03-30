/**
 * GateControl Client – Renderer
 * UI-Logik und State Management
 */

const { tunnel, server, config, killSwitch, autostart, logs, update, services, traffic, dns, shell, peer, getVersion, window: win } = window.gatecontrol;

// Version anzeigen
getVersion().then(v => {
	const el = document.getElementById('app-version');
	if (el) el.textContent = `v${v}`;
});

// Theme laden
config.get('app.theme').then(theme => {
	applyTheme(theme || 'dark');
});

function applyTheme(theme) {
	document.documentElement.setAttribute('data-theme', theme);
	document.querySelectorAll('.theme-btn').forEach(btn => {
		btn.classList.toggle('active', btn.dataset.theme === theme);
	});
}

// ── DOM-Elemente ─────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const el = {
	// Status
	ringFill:     $('#ring-fill'),
	ringContainer: $('#ring-container'),
	statusIcon:   $('#status-icon'),
	statusLabel:  $('#status-label'),
	connectBtn:   $('#connect-btn'),
	statEndpoint: $('#stat-endpoint'),
	statHandshake: $('#stat-handshake'),
	statRx:       $('#stat-rx'),
	statTx:       $('#stat-tx'),
	statRxSpeed:  $('#stat-rx-speed'),
	statTxSpeed:  $('#stat-tx-speed'),
	killswitchToggle: $('#killswitch-toggle'),
	
	// Settings
	serverUrl:    $('#server-url'),
	apiKey:       $('#api-key'),
	serverStatus: $('#server-status'),
	optAutostart: $('#opt-autostart'),
	optMinimized: $('#opt-minimized'),
	optAutoconnect: $('#opt-autoconnect'),
	optCheckInterval: $('#opt-check-interval'),
	optPollInterval:  $('#opt-poll-interval'),
	optSplitTunnel: $('#opt-split-tunnel'),
	optSplitRoutes: $('#opt-split-routes'),
	splitRoutesSection: $('#split-routes-section'),
	
	// Logs
	logOutput:    $('#log-output'),
};

// ── State ────────────────────────────────────────────────
let state = {
	status: 'disconnected',
	connected: false,
};

// ── Navigation ───────────────────────────────────────────
$$('.nav-btn').forEach(btn => {
	btn.addEventListener('click', () => {
		const page = btn.dataset.page;
		navigateTo(page);
	});
});

function navigateTo(page) {
	$$('.nav-btn').forEach(b => b.classList.remove('active'));
	$(`.nav-btn[data-page="${page}"]`)?.classList.add('active');
	
	$$('.page').forEach(p => p.classList.remove('active'));
	$(`#page-${page}`)?.classList.add('active');
	
	// Logs laden wenn Tab gewechselt
	if (page === 'logs') refreshLogs();
}

// Navigation aus dem Main Process
window.gatecontrol.onNavigate((page) => navigateTo(page));

// ── Titlebar ─────────────────────────────────────────────
$('#btn-minimize').addEventListener('click', () => win.minimize());
$('#btn-close').addEventListener('click', () => win.close());

// ── Tunnel State Updates ─────────────────────────────────
tunnel.onState((newState) => {
	state = { ...state, ...newState };
	updateUI();
});

// Initial Status laden
tunnel.getStatus().then(s => {
	if (s) {
		state = { ...state, ...s };
		updateUI();
	}
});

// ── UI Update ────────────────────────────────────────────
function updateUI() {
	const { status, connected, endpoint, handshake, rxBytes, txBytes, rxSpeed, txSpeed, killSwitch: ks } = state;
	
	// Ring
	el.ringFill.classList.remove('connected', 'connecting');
	el.statusIcon.classList.remove('connected', 'connecting');
	
	if (connected || status === 'connected') {
		el.ringFill.classList.add('connected');
		el.statusIcon.classList.add('connected');
		el.statusIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
		el.statusLabel.textContent = 'Verbunden';
		el.statusLabel.style.color = 'var(--accent)';
		
		el.connectBtn.classList.add('connected');
		el.connectBtn.classList.remove('connecting');
		el.connectBtn.querySelector('.connect-btn-text').textContent = 'Trennen';
		
	} else if (status === 'connecting' || status === 'reconnecting') {
		el.ringFill.classList.add('connecting');
		el.statusIcon.classList.add('connecting');
		el.statusIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>`;
		el.statusLabel.textContent = status === 'reconnecting' ? 'Reconnecting...' : 'Verbinde...';
		el.statusLabel.style.color = 'var(--warn)';
		
		el.connectBtn.classList.remove('connected');
		el.connectBtn.classList.add('connecting');
		
	} else {
		el.statusIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64A9 9 0 015.64 18.36M5.64 5.64A9 9 0 0118.36 18.36"/></svg>`;
		el.statusLabel.textContent = 'Getrennt';
		el.statusLabel.style.color = 'var(--text-3)';
		
		el.connectBtn.classList.remove('connected', 'connecting');
		el.connectBtn.querySelector('.connect-btn-text').textContent = 'Verbinden';
	}
	
	// Stats
	el.statEndpoint.textContent = endpoint || '—';
	el.statHandshake.textContent = handshake || '—';
	el.statRx.textContent = formatBytes(rxBytes || 0);
	el.statTx.textContent = formatBytes(txBytes || 0);

	// Speed
	if (connected && (rxSpeed || txSpeed)) {
		el.statRxSpeed.textContent = formatSpeed(rxSpeed || 0);
		el.statTxSpeed.textContent = formatSpeed(txSpeed || 0);
		updateBandwidthGraph(rxSpeed || 0, txSpeed || 0);
	} else {
		el.statRxSpeed.textContent = '';
		el.statTxSpeed.textContent = '';
	}

	// Bandwidth graph visibility
	const bwSection = $('#bandwidth-section');
	if (bwSection) bwSection.style.display = connected ? '' : 'none';

	// Kill-Switch
	el.killswitchToggle.checked = ks || false;
}

// ── Connect Button ───────────────────────────────────────
el.connectBtn.addEventListener('click', async () => {
	if (state.status === 'connecting') return;
	
	if (state.connected) {
		await tunnel.disconnect();
	} else {
		await tunnel.connect();
	}
});

// ── Kill-Switch Toggle ───────────────────────────────────
el.killswitchToggle.addEventListener('change', (e) => {
	killSwitch.toggle(e.target.checked);
});

// ── Settings: Server ─────────────────────────────────────
// Laden
config.getAll().then(cfg => {
	if (!cfg) return;
	el.serverUrl.value = cfg.server?.url || '';
	el.apiKey.value = cfg.server?.apiKey || '';
	el.optAutostart.checked = cfg.app?.startWithWindows ?? true;
	el.optMinimized.checked = cfg.app?.startMinimized ?? true;
	applyTheme(cfg.app?.theme || 'dark');
	el.optAutoconnect.checked = cfg.tunnel?.autoConnect ?? true;
	el.optCheckInterval.value = cfg.app?.checkInterval ?? 30;
	el.optPollInterval.value = cfg.app?.configPollInterval ?? 300;
	el.optSplitTunnel.checked = cfg.tunnel?.splitTunnel ?? false;
	el.optSplitRoutes.value = cfg.tunnel?.splitRoutes || '';
	el.splitRoutesSection.style.display = el.optSplitTunnel.checked ? '' : 'none';
});

// API-Key anzeigen/verbergen
$('#toggle-api-key').addEventListener('click', () => {
	const input = el.apiKey;
	input.type = input.type === 'password' ? 'text' : 'password';
});

// Server testen
$('#btn-test-server').addEventListener('click', async () => {
	showServerStatus('Teste Verbindung...', 'info');
	
	// Temporär URL setzen
	const url = el.serverUrl.value.trim();
	const key = el.apiKey.value.trim();
	
	if (!url || !key) {
		showServerStatus('URL und API-Key erforderlich', 'error');
		return;
	}
	
	const result = await server.test({ url, apiKey: key });
	if (result.success) {
		showServerStatus('Verbindung erfolgreich!', 'success');
	} else {
		showServerStatus(`Fehler: ${result.error}`, 'error');
	}
});

// Server speichern
$('#btn-save-server').addEventListener('click', async () => {
	const url = el.serverUrl.value.trim();
	const key = el.apiKey.value.trim();
	
	if (!url || !key) {
		showServerStatus('URL und API-Key erforderlich', 'error');
		return;
	}
	
	showServerStatus('Registriere Client...', 'info');
	
	const result = await server.setup({ url, apiKey: key });
	if (result.success) {
		showServerStatus(`Registriert! Peer-ID: ${result.peerId}`, 'success');
	} else {
		showServerStatus(`Fehler: ${result.error}`, 'error');
	}
});

function showServerStatus(message, type) {
	el.serverStatus.hidden = false;
	el.serverStatus.textContent = message;
	el.serverStatus.className = `field-status ${type}`;
	
	if (type === 'success') {
		setTimeout(() => { el.serverStatus.hidden = true; }, 5000);
	}
}

// ── Settings: Config Import ──────────────────────────────
$('#btn-import-file').addEventListener('click', async () => {
	const result = await config.importFile();
	if (result.success) {
		showServerStatus(`Config importiert: ${result.path}`, 'success');
	} else if (result.error) {
		showServerStatus(`Import-Fehler: ${result.error}`, 'error');
	}
});

// QR-Code Scanner
let qrStream = null;

$('#btn-import-qr').addEventListener('click', async () => {
	const preview = $('#qr-preview');
	const video = $('#qr-video');
	
	try {
		qrStream = await navigator.mediaDevices.getUserMedia({
			video: { facingMode: 'environment' }
		});

		video.srcObject = qrStream;
		preview.hidden = false;

		// QR-Code scannen mit 60s Timeout
		scanQR();
		setTimeout(() => {
			if (qrStream) {
				stopQRScan();
				showServerStatus('QR-Scan Timeout — kein Code erkannt.', 'error');
			}
		}, 60000);
	} catch (err) {
		showServerStatus(`Kamera-Fehler: ${err.message}`, 'error');
	}
});

$('#btn-qr-cancel').addEventListener('click', stopQRScan);

function stopQRScan() {
	if (qrStream) {
		qrStream.getTracks().forEach(t => t.stop());
		qrStream = null;
	}
	$('#qr-preview').hidden = true;
}

async function scanQR() {
	const video = $('#qr-video');
	const canvas = $('#qr-canvas');
	const ctx = canvas.getContext('2d');
	
	const scan = async () => {
		if (!qrStream) return;
		
		if (video.readyState === video.HAVE_ENOUGH_DATA) {
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			ctx.drawImage(video, 0, 0);
			
			const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const result = await config.importQR({
				data: Array.from(imageData.data),
				width: canvas.width,
				height: canvas.height,
			});
			
			if (result.success) {
				stopQRScan();
				showServerStatus('QR-Code erkannt! Config importiert.', 'success');
				return;
			}
		}
		
		requestAnimationFrame(scan);
	};
	
	scan();
}

// ── Settings: App Options ────────────────────────────────
el.optAutostart.addEventListener('change', (e) => {
	autostart.set(e.target.checked);
	config.set('app.startWithWindows', e.target.checked);
});

el.optMinimized.addEventListener('change', (e) => {
	config.set('app.startMinimized', e.target.checked);
});

el.optAutoconnect.addEventListener('change', (e) => {
	config.set('tunnel.autoConnect', e.target.checked);
});

el.optCheckInterval.addEventListener('change', (e) => {
	const val = Math.max(5, Math.min(300, parseInt(e.target.value, 10) || 30));
	e.target.value = val;
	config.set('app.checkInterval', val);
});

el.optPollInterval.addEventListener('change', (e) => {
	const val = Math.max(30, Math.min(3600, parseInt(e.target.value, 10) || 300));
	e.target.value = val;
	config.set('app.configPollInterval', val);
});

// ── Theme Switch ────────────────────────────────────────
document.querySelectorAll('.theme-btn').forEach(btn => {
	btn.addEventListener('click', () => {
		const theme = btn.dataset.theme;
		applyTheme(theme);
		config.set('app.theme', theme);
	});
});

// ── Split-Tunneling ─────────────────────────────────────
el.optSplitTunnel.addEventListener('change', async (e) => {
	config.set('tunnel.splitTunnel', e.target.checked);
	el.splitRoutesSection.style.display = e.target.checked ? '' : 'none';

	// Wenn verbunden: Reconnect anbieten
	if (state.connected) {
		showSplitStatus(e.target.checked
			? 'Split-Tunneling wird nach Neuverbindung aktiv.'
			: 'Full-Tunnel wird nach Neuverbindung aktiv.', 'info');
		await tunnel.disconnect();
		await tunnel.connect();
	}
});

$('#btn-save-split').addEventListener('click', async () => {
	const routes = el.optSplitRoutes.value.trim();
	config.set('tunnel.splitRoutes', routes);

	if (!routes) {
		showSplitStatus('Keine Routen eingetragen.', 'warn');
		return;
	}

	const count = routes.split('\n').filter(l => l.trim()).length;
	showSplitStatus(`${count} Route(n) gespeichert. Verbindung wird neu aufgebaut...`, 'info');

	// Reconnect wenn verbunden
	if (state.connected) {
		await tunnel.disconnect();
		await tunnel.connect();
	} else {
		showSplitStatus(`${count} Route(n) gespeichert. Wird beim nächsten Verbinden aktiv.`, 'info');
	}
});

function showSplitStatus(msg, type) {
	const el = $('#split-status');
	if (!el) return;
	el.style.display = '';
	el.textContent = msg;
	el.style.color = type === 'warn' ? 'var(--warn, #F59E0B)' : 'var(--accent)';
	el.style.background = type === 'warn' ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)';
	setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ── Logs ─────────────────────────────────────────────────
async function refreshLogs() {
	el.logOutput.textContent = 'Lade Logs...';
	const logText = await logs.get();
	el.logOutput.textContent = logText || 'Keine Logs verfügbar';
	el.logOutput.scrollTop = el.logOutput.scrollHeight;
}

$('#btn-refresh-logs').addEventListener('click', refreshLogs);

// ── Helpers ──────────────────────────────────────────────
function formatBytes(bytes) {
	if (!bytes || bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const val = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);
	return `${val} ${units[i]}`;
}

function formatSpeed(bytesPerSec) {
	if (bytesPerSec < 1) return '';
	if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
	if (bytesPerSec < 1048576) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
	return `${(bytesPerSec / 1048576).toFixed(1)} MB/s`;
}

// ── Bandwidth Graph (Canvas) ─────────────────────────────
const BW_HISTORY_LEN = 60; // 60 Datenpunkte (~5 min bei 5s Intervall)
const bwHistory = { rx: [], tx: [] };

function updateBandwidthGraph(rxSpeed, txSpeed) {
	bwHistory.rx.push(rxSpeed);
	bwHistory.tx.push(txSpeed);
	if (bwHistory.rx.length > BW_HISTORY_LEN) bwHistory.rx.shift();
	if (bwHistory.tx.length > BW_HISTORY_LEN) bwHistory.tx.shift();

	const canvas = document.getElementById('bandwidth-canvas');
	if (!canvas) return;

	const ctx = canvas.getContext('2d');
	const dpr = window.devicePixelRatio || 1;
	const w = canvas.clientWidth;
	const h = canvas.clientHeight;

	const newW = w * dpr;
	const newH = h * dpr;
	if (canvas.width !== newW || canvas.height !== newH) {
		canvas.width = newW;
		canvas.height = newH;
	}
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, w, h);

	const allValues = [...bwHistory.rx, ...bwHistory.tx];
	const maxVal = Math.max(...allValues, 1024); // min 1 KB/s scale

	// Grid lines
	const isLight = document.documentElement.getAttribute('data-theme') === 'light';
	ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
	ctx.lineWidth = 1;
	for (let i = 1; i < 4; i++) {
		const y = (h / 4) * i;
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(w, y);
		ctx.stroke();
	}

	// Scale label
	ctx.fillStyle = isLight ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.2)';
	ctx.font = '9px monospace';
	ctx.fillText(formatSpeed(maxVal), 2, 10);

	// Draw line
	function drawLine(data, color) {
		if (data.length < 2) return;
		const step = w / (BW_HISTORY_LEN - 1);

		// Fill area
		ctx.beginPath();
		ctx.moveTo(0, h);
		for (let i = 0; i < data.length; i++) {
			const x = (BW_HISTORY_LEN - data.length + i) * step;
			const y = h - (data[i] / maxVal) * (h - 12);
			ctx.lineTo(x, y);
		}
		ctx.lineTo((BW_HISTORY_LEN - 1) * step, h);
		ctx.closePath();
		ctx.fillStyle = color.replace('1)', '0.1)');
		ctx.fill();

		// Stroke line
		ctx.beginPath();
		for (let i = 0; i < data.length; i++) {
			const x = (BW_HISTORY_LEN - data.length + i) * step;
			const y = h - (data[i] / maxVal) * (h - 12);
			i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
		}
		ctx.strokeStyle = color;
		ctx.lineWidth = 1.5;
		ctx.stroke();
	}

	drawLine(bwHistory.rx, 'rgba(34, 197, 94, 1)');  // grün = download
	drawLine(bwHistory.tx, 'rgba(59, 130, 246, 1)');  // blau = upload

	// Legend
	ctx.fillStyle = 'rgba(34, 197, 94, 0.8)';
	ctx.fillRect(w - 90, 4, 8, 8);
	ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
	ctx.fillRect(w - 90, 16, 8, 8);
	ctx.fillStyle = isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.4)';
	ctx.font = '9px sans-serif';
	ctx.fillText('↓ Download', w - 78, 12);
	ctx.fillText('↑ Upload', w - 78, 24);
}

// Stats werden via IPC tunnel.onState gepusht (kein separater Poll nötig)

// ── Auto-Update UI ──────────────────────────────────────
function showUpdateBanner(info) {
	const existing = $('#update-banner');
	if (existing) existing.remove();

	const banner = document.createElement('div');
	banner.id = 'update-banner';
	banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;padding:12px 16px;background:var(--bg-3);border-top:1px solid var(--accent);display:flex;align-items:center;gap:12px;z-index:100';

	const text = document.createElement('div');
	text.style.cssText = 'flex:1;font-size:12px;color:var(--text-1)';
	const strong = document.createElement('strong');
	strong.textContent = `Update v${info.version}`;
	text.appendChild(strong);
	text.appendChild(document.createTextNode(' bereit zur Installation'));
	banner.appendChild(text);

	const laterBtn = document.createElement('button');
	laterBtn.textContent = 'Später';
	laterBtn.style.cssText = 'padding:6px 12px;font-size:11px;background:transparent;color:var(--text-3);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer';
	laterBtn.addEventListener('click', () => banner.remove());
	banner.appendChild(laterBtn);

	const installBtn = document.createElement('button');
	installBtn.textContent = 'Jetzt neustarten';
	installBtn.style.cssText = 'padding:6px 12px;font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;font-weight:600';
	installBtn.addEventListener('click', () => update.install());
	banner.appendChild(installBtn);

	document.body.appendChild(banner);
}

update.onReady((info) => showUpdateBanner(info));

// ── Peer-Ablauf-Warnung ─────────────────────────────────
peer.onExpiry((info) => {
	const existing = $('#expiry-banner');
	if (existing) existing.remove();

	const banner = document.createElement('div');
	banner.id = 'expiry-banner';

	let msg, color;
	if (info.daysLeft <= 0) {
		msg = 'Dein VPN-Zugang ist abgelaufen!';
		color = 'var(--error)';
	} else if (info.daysLeft <= 1) {
		msg = 'Dein VPN-Zugang läuft heute ab!';
		color = 'var(--error)';
	} else {
		msg = `Dein VPN-Zugang läuft in ${info.daysLeft} Tagen ab`;
		color = info.daysLeft <= 3 ? 'var(--warn, #F59E0B)' : 'var(--text-2)';
	}

	banner.style.cssText = `padding:8px 12px;margin-top:8px;border-radius:var(--radius);font-size:11px;text-align:center;border:1px solid ${color};color:${color};background:rgba(0,0,0,0.2)`;
	banner.textContent = msg;

	const statsGrid = $('#stats-grid');
	if (statsGrid) statsGrid.parentNode.insertBefore(banner, statsGrid.nextSibling);
});
update.check().then((info) => { if (info) showUpdateBanner(info); });

// ── Erreichbare Dienste ─────────────────────────────────
async function loadServices() {
	const list = await services.list();
	const section = $('#services-section');
	const container = $('#services-list');
	if (!list || list.length === 0) {
		section.style.display = 'none';
		return;
	}

	section.style.display = '';
	container.textContent = '';

	list.forEach((svc) => {
		const item = document.createElement('div');
		item.className = 'service-item';
		item.addEventListener('click', () => shell.openExternal(svc.url));

		const left = document.createElement('div');
		const name = document.createElement('div');
		name.className = 'service-name';
		name.textContent = svc.name;
		left.appendChild(name);

		const domain = document.createElement('div');
		domain.className = 'service-domain';
		domain.textContent = svc.domain;
		left.appendChild(domain);

		item.appendChild(left);

		if (svc.hasAuth) {
			const badge = document.createElement('span');
			badge.className = 'service-auth';
			badge.textContent = 'Auth';
			item.appendChild(badge);
		}

		container.appendChild(item);
	});
}

// Dienste und Traffic laden wenn verbunden
tunnel.onState((s) => {
	if (s.connected || s.status === 'connected') {
		loadServices();
		loadTraffic();
	}
});

// ── Traffic-Verbrauch ───────────────────────────────────
async function loadTraffic() {
	const data = await traffic.stats();
	const section = $('#traffic-usage');
	const grid = $('#traffic-grid');
	if (!data || !section || !grid) return;

	section.style.display = '';
	grid.textContent = '';

	const periods = [
		{ label: '24h', data: data.last24h },
		{ label: '7 Tage', data: data.last7d },
		{ label: '30 Tage', data: data.last30d },
		{ label: 'Gesamt', data: data.total },
	];

	for (const p of periods) {
		const card = document.createElement('div');
		card.className = 'traffic-card';

		const label = document.createElement('div');
		label.className = 'traffic-card-label';
		label.textContent = p.label;
		card.appendChild(label);

		const rx = document.createElement('div');
		rx.className = 'traffic-card-rx';
		rx.textContent = `↓ ${formatBytes(p.data?.rx || 0)}`;
		card.appendChild(rx);

		const tx = document.createElement('div');
		tx.className = 'traffic-card-tx';
		tx.textContent = `↑ ${formatBytes(p.data?.tx || 0)}`;
		card.appendChild(tx);

		grid.appendChild(card);
	}
}

// ── DNS-Leak-Test ───────────────────────────────────────
const dnsBtn = $('#dns-test-btn');
const dnsResult = $('#dns-result');

if (dnsBtn) {
	dnsBtn.addEventListener('click', async () => {
		dnsBtn.disabled = true;
		dnsBtn.textContent = 'Teste...';
		dnsResult.style.display = 'none';

		try {
			const result = await dns.leakTest();

			dnsResult.style.display = '';
			dnsResult.textContent = '';

			if (result.passed) {
				dnsResult.className = 'dns-result pass';
				const title = document.createElement('div');
				title.style.fontWeight = '600';
				title.textContent = 'Kein DNS-Leak erkannt';
				dnsResult.appendChild(title);

				const detail = document.createElement('div');
				detail.style.marginTop = '4px';
				detail.textContent = `Dein Traffic läuft über den VPN-Tunnel. DNS: ${(result.dnsServers || []).join(', ')}`;
				dnsResult.appendChild(detail);
			} else {
				dnsResult.className = 'dns-result fail';
				const title = document.createElement('div');
				title.style.fontWeight = '600';
				title.textContent = 'DNS-Leak möglich';
				dnsResult.appendChild(title);

				const detail = document.createElement('div');
				detail.style.marginTop = '4px';
				detail.textContent = `DNS-Anfragen gehen möglicherweise am VPN vorbei. Aktiviere den Kill-Switch um dies zu unterbinden. DNS: ${(result.dnsServers || []).join(', ')}`;
				dnsResult.appendChild(detail);
			}
		} catch {
			dnsResult.style.display = '';
			dnsResult.className = 'dns-result fail';
			dnsResult.textContent = 'Test fehlgeschlagen — Verbindung prüfen.';
		}

		dnsBtn.disabled = false;
		dnsBtn.textContent = 'DNS-Leak-Test';
	});
}
