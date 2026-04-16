/**
 * GateControl Client – Electron Main Process (Community)
 *
 * Thin wrapper around @gatecontrol/client-core.
 * All business logic lives in the core package.
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, Notification, screen } = require('electron');
const path = require('path');

const {
  WireGuardService,
  ApiClient,
  KillSwitch,
  RdpAllow,
  ConnectionMonitor,
  Updater,
  createLogger,
  createStores,
  registerBaseHandlers,
} = require('@gatecontrol/client-core');

const { i18n } = require('@gatecontrol/client-core');
const { t, setLocale, getLocale, resolveLocale } = i18n;

// ── Logging ──────────────────────────────────────────────────
const log = createLogger();

// ── Single Instance Lock ─────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
}

// ── Store ────────────────────────────────────────────────────
const { store } = createStores({
  userDataPath: app.getPath('userData'),
  log,
});

// ── Globale Referenzen ───────────────────────────────────────
let mainWindow = null;
let tray = null;
let wgService = null;
let killSwitch = null;
let rdpAllow = null;
let apiClient = null;
let connectionMonitor = null;
let updater = null;
let pendingUpdate = null;

// ── State ────────────────────────────────────────────────────
let tunnelState = {
	connected: false,
	interface: null,
	endpoint: null,
	handshake: null,
	rxBytes: 0,
	txBytes: 0,
	uptime: 0,
	connectedSince: null,
};
let isReconnecting = false;

// ── Pfade ────────────────────────────────────────────────────
const RESOURCES_PATH = app.isPackaged
	? path.join(process.resourcesPath, 'resources')
	: path.join(__dirname, '..', '..', 'resources');

const WG_CONFIG_DIR = path.join(app.getPath('userData'), 'wireguard');
const WG_CONFIG_FILE = path.join(WG_CONFIG_DIR, 'gatecontrol0.conf');

// ── Helpers ──────────────────────────────────────────────────
function formatBytesShort(bytes) {
	if (!bytes || bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

// ── Tray Icon (Sun/Star design — circle + 8 rays) ───────────
function getIcon(state) {
	const color = state === 'connected' ? [0x22, 0xC5, 0x5E]   // green
		: state === 'connecting' ? [0xF5, 0x9E, 0x0B]             // amber
		: [0xEF, 0x44, 0x44];                                      // red

	const size = 32;
	const buf = Buffer.alloc(size * size * 4, 0);
	const cx = size / 2;
	const cy = size / 2;

	function setPixel(px, py) {
		const x = Math.round(px);
		const y = Math.round(py);
		if (x < 0 || x >= size || y < 0 || y >= size) return;
		const i = (y * size + x) * 4;
		buf[i] = color[0]; buf[i + 1] = color[1]; buf[i + 2] = color[2]; buf[i + 3] = 255;
	}

	// Ring
	const ringR = 5.0;
	const ringThick = 1.8;
	for (let a = 0; a < 360; a += 1) {
		const rad = a * Math.PI / 180;
		for (let t = -ringThick / 2; t <= ringThick / 2; t += 0.4) {
			setPixel(cx + (ringR + t) * Math.cos(rad), cy + (ringR + t) * Math.sin(rad));
		}
	}

	// Center dot
	for (let dx = -1.5; dx <= 1.5; dx += 0.5) {
		for (let dy = -1.5; dy <= 1.5; dy += 0.5) {
			if (dx * dx + dy * dy <= 2.0) setPixel(cx + dx, cy + dy);
		}
	}

	// 8 rays
	const rayInner = 8.5;
	const rayOuter = 13.5;
	const rayThick = 2.0;
	for (let i = 0; i < 8; i++) {
		const angle = i * 45 * Math.PI / 180;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		const perpCos = Math.cos(angle + Math.PI / 2);
		const perpSin = Math.sin(angle + Math.PI / 2);
		for (let d = rayInner; d <= rayOuter; d += 0.3) {
			for (let t = -rayThick / 2; t <= rayThick / 2; t += 0.4) {
				setPixel(cx + d * cos + t * perpCos, cy + d * sin + t * perpSin);
			}
		}
		for (let dx = -rayThick / 2; dx <= rayThick / 2; dx += 0.4) {
			for (let dy = -rayThick / 2; dy <= rayThick / 2; dy += 0.4) {
				if (dx * dx + dy * dy <= (rayThick / 2) * (rayThick / 2)) {
					setPixel(cx + rayInner * cos + dx * perpCos + dy * cos, cy + rayInner * sin + dx * perpSin + dy * sin);
					setPixel(cx + rayOuter * cos + dx * perpCos + dy * cos, cy + rayOuter * sin + dx * perpSin + dy * sin);
				}
			}
		}
	}

	return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function updateTray(state) {
	if (!tray) return;

	tray.setImage(getIcon(state));

	const statusText = state === 'connected' ? t('status.connected')
		: state === 'connecting' ? t('status.connecting')
		: t('status.disconnected');

	let tooltip = `GateControl – ${statusText}`;
	if (tunnelState.connected) {
		const serverUrl = store.get('server.url', '');
		if (serverUrl) tooltip += `\n${serverUrl}`;
		if (tunnelState.connectedSince) {
			const dur = Math.floor((Date.now() - new Date(tunnelState.connectedSince).getTime()) / 1000);
			const h = Math.floor(dur / 3600);
			const m = Math.floor((dur % 3600) / 60);
			const duration = `${h > 0 ? h + 'h ' : ''}${m}m`;
			tooltip += `\n${t('tray.connectedSince', { duration })}`;
		}
		const rx = tunnelState.rxBytes || 0;
		const tx = tunnelState.txBytes || 0;
		tooltip += `\n↓ ${formatBytesShort(rx)}  ↑ ${formatBytesShort(tx)}`;
	}
	tray.setToolTip(tooltip);

	const contextMenu = Menu.buildFromTemplate([
		{
			label: `GateControl – ${statusText}`,
			enabled: false,
			icon: getIcon(state),
		},
		{ type: 'separator' },
		{
			label: state === 'connected' ? '⬤ ' + t('status.connected') : '○ ' + t('status.disconnected'),
			enabled: false,
		},
		...((store.get('server.url', '') || tunnelState.endpoint) ? [{
			label: `Server: ${store.get('server.url', '') || tunnelState.endpoint}`,
			enabled: false,
		}] : []),
		...(tunnelState.handshake ? [{
			label: `Handshake: ${tunnelState.handshake}`,
			enabled: false,
		}] : []),
		{ type: 'separator' },
		{
			label: state === 'connected' ? t('action.disconnect') : t('action.connect'),
			click: () => state === 'connected' ? disconnectTunnel() : connectTunnel(),
		},
		{ type: 'separator' },
		{
			label: t('killswitch.label'),
			type: 'checkbox',
			checked: store.get('tunnel.killSwitch', false),
			click: (item) => toggleKillSwitch(item.checked),
		},
		{ type: 'separator' },
		{
			label: t('tray.openWindow'),
			click: () => showWindow(),
		},
		{
			label: t('tray.settings'),
			click: () => {
				showWindow();
				mainWindow?.webContents.send('navigate', 'settings');
			},
		},
		...(pendingUpdate ? [
			{ type: 'separator' },
			{
				label: t('tray.installUpdate', { version: pendingUpdate.version }),
				click: () => installUpdate(),
			},
		] : []),
		{ type: 'separator' },
		{
			label: t('tray.quit'),
			click: () => quitApp(),
		},
	]);

	tray.setContextMenu(contextMenu);
}

// ── Fenster ──────────────────────────────────────────────────
function createWindow() {
	const dpi = screen.getPrimaryDisplay().scaleFactor;
	mainWindow = new BrowserWindow({
		width: Math.round(590 / dpi),
		minWidth: Math.round(590 / dpi),
		maxWidth: Math.round(590 / dpi),
		height: Math.round(store.get('app.windowHeight', 1280) / dpi),
		minHeight: Math.round(500 / dpi),
		resizable: true,
		frame: false,
		backgroundColor: store.get('app.theme', 'dark') === 'light' ? '#F8F9FB' : '#0F1117',
		titleBarStyle: 'hidden',
		show: false,
		icon: app.isPackaged
			? path.join(process.resourcesPath, 'resources', 'icons', 'app-icon.png')
			: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: false,
		},
	});

	mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

	mainWindow.once('ready-to-show', () => {
		if (!store.get('app.startMinimized', true)) {
			mainWindow.show();
		}
	});

	mainWindow.on('resize', () => {
		const [, height] = mainWindow.getSize();
		store.set('app.windowHeight', Math.round(height * dpi));
	});

	mainWindow.on('close', (e) => {
		if (!app.isQuitting) {
			e.preventDefault();
			mainWindow.hide();
		}
	});

	mainWindow.on('closed', () => {
		mainWindow = null;
	});
}

function showWindow() {
	if (!mainWindow) {
		createWindow();
		mainWindow.show();
	} else {
		mainWindow.show();
		mainWindow.focus();
	}
}

// ── WireGuard Tunnel ─────────────────────────────────────────
async function connectTunnel() {
	if (isReconnecting) {
		log.debug('Reconnect läuft bereits, überspringe connectTunnel');
		return;
	}
	try {
		log.info('Tunnel-Verbindung wird aufgebaut...');
		connectionMonitor.stop();
		updateTray('connecting');
		broadcastState('connecting');

		const serverUrl = store.get('server.url');
		const apiKey = store.get('server.apiKey');

		if (serverUrl && apiKey) {
			try {
				const config = await apiClient.fetchConfig();
				if (config) {
					await wgService.writeConfig(WG_CONFIG_FILE, config);
					log.info('Konfiguration vom Server aktualisiert');
				}
			} catch (err) {
				log.warn('Config-Abruf fehlgeschlagen, nutze lokale Config:', err.message);
			}
		}

		if (store.get('tunnel.killSwitch', false)) {
			await killSwitch.enable(WG_CONFIG_FILE);
			log.info('Kill-Switch aktiviert');
		}

		await wgService.connect(WG_CONFIG_FILE, store.get('tunnel.splitTunnel') ? store.get('tunnel.splitRoutes', '') : null);

		tunnelState.connected = true;
		tunnelState.connectedSince = new Date();

		updateTray('connected');
		broadcastState('connected');

		connectionMonitor.start();

		showNotification(t('notify.connected'), t('notify.connected'));
		log.info('Tunnel erfolgreich verbunden');

		checkPeerExpiry();

	} catch (err) {
		log.error('Tunnel-Verbindung fehlgeschlagen:', err);
		updateTray('disconnected');
		broadcastState('error', err.message);
		showNotification(t('notify.connectionError'), err.message);
	}
}

async function disconnectTunnel() {
	try {
		log.info('Tunnel wird getrennt...');

		connectionMonitor.stop();

		await wgService.disconnect();

		if (store.get('tunnel.killSwitch', false)) {
			await killSwitch.disable();
			log.info('Kill-Switch deaktiviert');
		}

		tunnelState.connected = false;
		tunnelState.connectedSince = null;
		tunnelState.rxBytes = 0;
		tunnelState.txBytes = 0;

		updateTray('disconnected');
		broadcastState('disconnected');

		showNotification(t('notify.disconnected'), t('notify.disconnected'));
		log.info('Tunnel getrennt');

	} catch (err) {
		log.error('Fehler beim Trennen:', err);
	}
}

async function toggleKillSwitch(enabled) {
	store.set('tunnel.killSwitch', enabled);

	if (enabled && tunnelState.connected) {
		await killSwitch.enable(WG_CONFIG_FILE);
	} else if (!enabled) {
		await killSwitch.disable();
	}

	broadcastState(tunnelState.connected ? 'connected' : 'disconnected');
}

async function toggleRdpAllow(enabled) {
	store.set('tunnel.rdpAllow', enabled);

	if (enabled) {
		await rdpAllow.enable(WG_CONFIG_FILE);
	} else {
		await rdpAllow.disable();
	}

	broadcastState(tunnelState.connected ? 'connected' : 'disconnected');
}

// ── Reconnect Logic ──────────────────────────────────────────
async function handleDisconnect() {
	if (isReconnecting) return;
	isReconnecting = true;

	log.warn('Verbindungsabbruch erkannt, versuche Reconnect...');

	tunnelState.connected = false;
	updateTray('connecting');
	broadcastState('reconnecting');

	const maxRetries = 10;
	const baseDelay = 2000;

	for (let i = 0; i < maxRetries; i++) {
		const delay = Math.min(baseDelay * Math.pow(1.5, i), 60000);
		log.info(`Reconnect-Versuch ${i + 1}/${maxRetries} in ${delay}ms...`);

		await new Promise(r => setTimeout(r, delay));

		try {
			await wgService.disconnect().catch(() => {});
			await wgService.connect(WG_CONFIG_FILE, store.get('tunnel.splitTunnel') ? store.get('tunnel.splitRoutes', '') : null);

			tunnelState.connected = true;
			tunnelState.connectedSince = new Date();
			isReconnecting = false;
			updateTray('connected');
			broadcastState('connected');
			connectionMonitor.start();

			showNotification(t('notify.reconnected'), t('notify.reconnected'));
			log.info('Reconnect erfolgreich');
			return;
		} catch (err) {
			log.warn(`Reconnect-Versuch ${i + 1} fehlgeschlagen:`, err.message);
		}
	}

	log.error('Alle Reconnect-Versuche fehlgeschlagen');
	isReconnecting = false;
	updateTray('disconnected');
	broadcastState('error', t('notify.reconnectFailed'));
	showNotification(t('notify.connectionError'), t('notify.reconnectFailed'));
}

// ── Notifications ────────────────────────────────────────────
function showNotification(title, body) {
	if (Notification.isSupported()) {
		new Notification({
			title: `GateControl: ${title}`,
			body,
			icon: app.isPackaged
				? path.join(process.resourcesPath, 'resources', 'icons', 'app-icon.png')
				: path.join(__dirname, '..', '..', 'build', 'icon.png'),
		}).show();
	}
}

// ── Peer-Ablauf-Warnung ─────────────────────────────────
async function checkPeerExpiry() {
	try {
		const peerInfo = await apiClient?.getPeerInfo();
		if (!peerInfo?.expiresAt) return;

		const expiresAt = new Date(peerInfo.expiresAt);
		const now = new Date();
		const daysLeft = Math.ceil((expiresAt - now) / 86400000);

		if (daysLeft <= 0) {
			showNotification(t('notify.peerExpiredTitle'), t('notify.peerExpiredBody'));
			mainWindow?.webContents.send('peer-expiry', { daysLeft: 0, expiresAt: peerInfo.expiresAt });
		} else if (daysLeft <= 1) {
			showNotification(t('notify.peerExpiresTodayTitle'), t('notify.peerExpiresTodayBody'));
			mainWindow?.webContents.send('peer-expiry', { daysLeft, expiresAt: peerInfo.expiresAt });
		} else if (daysLeft <= 3) {
			showNotification(t('notify.peerExpiresSoonTitle'), t('notify.peerExpiresSoonBody', { days: daysLeft }));
			mainWindow?.webContents.send('peer-expiry', { daysLeft, expiresAt: peerInfo.expiresAt });
		} else if (daysLeft <= 7) {
			showNotification(t('notify.peerExpiryNotice'), t('notify.peerExpiresSoonBody', { days: daysLeft }));
			mainWindow?.webContents.send('peer-expiry', { daysLeft, expiresAt: peerInfo.expiresAt });
		}

		if (daysLeft <= 7) {
			log.info(`Peer läuft ab in ${daysLeft} Tagen (${peerInfo.expiresAt})`);
		}
	} catch (err) {
		log.debug('Peer-Ablauf-Prüfung fehlgeschlagen:', err.message);
	}
}

// ── Auto-Update UI ──────────────────────────────────────────
function showUpdateNotification(release) {
	showNotification(t('update.available', { version: release.version }), t('update.readyToInstall'));
	mainWindow?.webContents.send('update-ready', {
		version: release.version,
		releaseNotes: release.releaseNotes,
	});
}

async function installUpdate() {
	if (!pendingUpdate || !updater?.isUpdateReady()) return false;

	log.info('Update-Installation gestartet...');

	if (tunnelState.connected) {
		await disconnectTunnel();
	}

	if (store.get('tunnel.killSwitch', false)) {
		try {
			await killSwitch.disable();
			store.set('tunnel.killSwitch', false);
		} catch {}
	}

	updater.install();

	setTimeout(() => quitApp(), 1500);
	return true;
}

// ── IPC ──────────────────────────────────────────────────────
function broadcastState(status, error = null) {
	const state = {
		status,
		error,
		connected: tunnelState.connected,
		endpoint: store.get('server.url', '') || tunnelState.endpoint,
		handshake: tunnelState.handshake,
		rxBytes: tunnelState.rxBytes,
		txBytes: tunnelState.txBytes,
		rxSpeed: tunnelState.rxSpeed || 0,
		txSpeed: tunnelState.txSpeed || 0,
		connectedSince: tunnelState.connectedSince,
		killSwitch: store.get('tunnel.killSwitch', false),
		rdpAllow: store.get('tunnel.rdpAllow', false),
	};

	mainWindow?.webContents.send('tunnel-state', state);
}

// ── App Lifecycle ────────────────────────────────────────────
async function initServices() {
	const fs = require('fs');
	if (!fs.existsSync(WG_CONFIG_DIR)) {
		fs.mkdirSync(WG_CONFIG_DIR, { recursive: true });
	}

	wgService = new WireGuardService(log, { resourcesPath: RESOURCES_PATH });
	killSwitch = new KillSwitch(log);
	rdpAllow = new RdpAllow(log);
	apiClient = new ApiClient(
		store.get('server.url', ''),
		store.get('server.apiKey', ''),
		log,
		store.get('server.peerId', '') || null,
		{ clientVersion: require('../../package.json').version }
	);

	connectionMonitor = new ConnectionMonitor({
		interval: store.get('app.checkInterval', 30) * 1000,
		apiClient,
		onDisconnect: handleDisconnect,
		onPeerDisabled: async (peerInfo) => {
			log.warn(`Peer disabled on server (id: ${peerInfo?.id}, name: ${peerInfo?.name}) — disconnecting`);
			await disconnectTunnel();
			new Notification({
				title: 'GateControl',
				body: t('notify.peerDisabled'),
			}).show();
		},
		onStats: (stats) => {
			const now = Date.now();
			if (tunnelState._lastStatsTime && stats.rxBytes !== undefined) {
				const dt = (now - tunnelState._lastStatsTime) / 1000;
				if (dt > 0) {
					stats.rxSpeed = Math.max(0, ((stats.rxBytes || 0) - (tunnelState.rxBytes || 0)) / dt);
					stats.txSpeed = Math.max(0, ((stats.txBytes || 0) - (tunnelState.txBytes || 0)) / dt);
				}
			}
			tunnelState = { ...tunnelState, ...stats, _lastStatsTime: now };
			const trayState = tunnelState.connected ? 'connected' : 'disconnected';
			updateTray(trayState);
			broadcastState(trayState);
		},
		wgService,
		log,
	});

	const savedLocale = store.get('app.locale');
	if (savedLocale) {
		setLocale(savedLocale);
	} else {
		setLocale(resolveLocale(app.getLocale()));
	}
}

app.whenReady().then(async () => {
	app.setAppUserModelId('GateControl Client');
	log.info('GateControl Client wird gestartet...');

	await initServices();

	// Kill-Switch Cleanup
	try {
		const wasActive = await killSwitch.isActive();
		if (wasActive && !store.get('tunnel.killSwitch', false)) {
			log.warn('Verwaiste Kill-Switch Regeln gefunden — bereinige...');
			await killSwitch.disable();
		} else if (wasActive) {
			log.info('Kill-Switch war beim letzten Beenden aktiv — Regeln bleiben bestehen');
			killSwitch.enabled = true;
		}
	} catch (err) {
		log.debug('Kill-Switch Cleanup:', err.message);
	}

	// RDP Allow Cleanup
	try {
		const rdpWasActive = await rdpAllow.isActive();
		if (rdpWasActive && !store.get('tunnel.rdpAllow', false)) {
			log.warn('Verwaiste RDP-Allow Regeln gefunden — bereinige...');
			await rdpAllow.disable();
		} else if (rdpWasActive) {
			log.info('RDP Allow war beim letzten Beenden aktiv — Regeln bleiben bestehen');
			rdpAllow.enabled = true;
		}
	} catch (err) {
		log.debug('RDP Allow Cleanup:', err.message);
	}

	// IPC Handler registrieren (from core)
	registerBaseHandlers(ipcMain, {
		app,
		dialog,
		getMainWindow: () => mainWindow,
		store,
		wgService,
		apiClient,
		killSwitch,
		updater,
		log,
		connectTunnel,
		disconnectTunnel,
		toggleKillSwitch,
		toggleRdpAllow,
		installUpdate,
		getTunnelState: () => tunnelState,
		wgConfigFile: WG_CONFIG_FILE,
	});

	// Locale IPC Handler
	ipcMain.handle('locale:set', (_, locale) => {
		setLocale(locale);
		store.set('app.locale', getLocale());
		updateTray(tunnelState.connected ? 'connected' : 'disconnected');
		mainWindow?.webContents.send('locale:changed', getLocale());
	});
	ipcMain.handle('locale:get', () => getLocale());

	// Tray
	tray = new Tray(getIcon('disconnected'));
	tray.on('double-click', () => showWindow());
	updateTray('disconnected');

	// Fenster
	createWindow();

	// Auto-Connect
	if (store.get('tunnel.autoConnect', true)) {
		const configExists = require('fs').existsSync(WG_CONFIG_FILE);
		const hasServer = store.get('server.url', '') !== '';

		if (configExists || hasServer) {
			log.info('Auto-Connect aktiv, verbinde...');
			setTimeout(() => connectTunnel(), 2000);
		} else {
			log.info('Keine Konfiguration vorhanden, überspringe Auto-Connect');
			showWindow();
		}
	}

	// Config-Polling
	const pollInterval = store.get('app.configPollInterval', 300) * 1000;
	if (store.get('server.url', '')) {
		setInterval(async () => {
			try {
				const newConfig = await apiClient.checkConfigUpdate();
				if (newConfig) {
					// Validate before applying — reject empty or malformed configs
					if (!newConfig.includes('[Interface]') || !newConfig.includes('PrivateKey')) {
						log.warn('Config update rejected: missing [Interface] or PrivateKey');
					} else {
						log.info('Neue Konfiguration vom Server erhalten');
						await wgService.writeConfig(WG_CONFIG_FILE, newConfig);
						if (tunnelState.connected) {
							await disconnectTunnel();
							await connectTunnel();
						}
					}
				}
			} catch (err) {
				log.debug('Config-Poll fehlgeschlagen:', err.message);
			}
		}, pollInterval);
	}

	// Auto-Update
	updater = new Updater({
		serverUrl: store.get('server.url', ''),
		apiKey: store.get('server.apiKey', ''),
		log,
	});
	updater.start((release) => {
		pendingUpdate = release;
		log.info(`Update bereit: v${release.version}`);
		updateTray(tunnelState.connected ? 'connected' : 'disconnected');
		showUpdateNotification(release);
	});

	// Autostart
	if (store.get('app.startWithWindows', true)) {
		app.setLoginItemSettings({
			openAtLogin: true,
			path: process.execPath,
			args: ['--minimized'],
		});
	}

	log.info('GateControl Client bereit');
});

app.on('second-instance', () => {
	showWindow();
});

app.on('window-all-closed', (e) => {
	e.preventDefault();
});

async function quitApp() {
	app.isQuitting = true;

	updater?.stop();

	if (tunnelState.connected) {
		await disconnectTunnel();
	}

	if (killSwitch?.enabled) {
		try {
			await killSwitch.disable();
			store.set('tunnel.killSwitch', false);
		} catch {}
	}

	if (rdpAllow?.enabled) {
		try {
			await rdpAllow.disable();
			store.set('tunnel.rdpAllow', false);
		} catch {}
	}

	tray?.destroy();
	app.quit();
}

app.on('before-quit', async () => {
	app.isQuitting = true;
});
