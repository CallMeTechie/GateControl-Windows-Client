/**
 * GateControl Client – Electron Main Process
 * 
 * Verwaltet WireGuard-Tunnel, Tray-Icon, Auto-Connect,
 * Kill-Switch und API-Kommunikation mit dem GateControl-Server.
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, Notification, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');
const log = require('electron-log');

const WireGuardService = require('../services/wireguard-native');
const KillSwitch = require('../services/killswitch');
const ApiClient = require('../services/api-client');
const Updater = require('../services/updater');
const ConnectionMonitor = require('../services/connection-monitor');

// ── Logging ──────────────────────────────────────────────────
log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB
log.transports.console.level = 'debug';

// ── Single Instance Lock ─────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
}

// ── Konfiguration ────────────────────────────────────────────
const store = new Store({
	name: 'gatecontrol-config',
	encryptionKey: 'gatecontrol-v1',
	schema: {
		server: {
			type: 'object',
			properties: {
				url:    { type: 'string', default: '' },
				apiKey: { type: 'string', default: '' },
				peerId: { type: 'string', default: '' },
			},
			default: {},
		},
		tunnel: {
			type: 'object',
			properties: {
				interfaceName: { type: 'string', default: 'gatecontrol0' },
				autoConnect:   { type: 'boolean', default: true },
				killSwitch:    { type: 'boolean', default: false },
				splitTunnel:   { type: 'boolean', default: false },
				splitRoutes:   { type: 'string', default: '' },
				configPath:    { type: 'string', default: '' },
			},
			default: {},
		},
		app: {
			type: 'object',
			properties: {
				startMinimized: { type: 'boolean', default: true },
				startWithWindows: { type: 'boolean', default: true },
				theme:          { type: 'string', default: 'dark' },
				checkInterval:  { type: 'number', default: 30 },
				configPollInterval: { type: 'number', default: 300 },
			},
			default: {},
		},
	},
});

// ── Globale Referenzen ───────────────────────────────────────
let mainWindow = null;
let tray = null;
let wgService = null;
let killSwitch = null;
let apiClient = null;
let connectionMonitor = null;
let updater = null;
let pendingUpdate = null; // { version, releaseNotes, installerPath }

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

// ── Pfade ────────────────────────────────────────────────────
const RESOURCES_PATH = app.isPackaged
	? path.join(process.resourcesPath, 'resources')
	: path.join(__dirname, '..', '..', 'resources');

const WG_CONFIG_DIR = path.join(app.getPath('userData'), 'wireguard');
const WG_CONFIG_FILE = path.join(WG_CONFIG_DIR, 'gatecontrol0.conf');

// ── Helpers ──────────────────────────────────────────────────
function formatBytesShort(bytes) {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

// ── Tray Icon ────────────────────────────────────────────────
function getIcon(state) {
	const iconName = state === 'connected' ? 'tray-connected'
		: state === 'connecting' ? 'tray-connecting'
		: 'tray-disconnected';
	
	const iconPath = path.join(RESOURCES_PATH, 'icons', `${iconName}.png`);
	
	try {
		return nativeImage.createFromPath(iconPath);
	} catch {
		// Fallback: Erstelle einfache Icons programmatisch
		return createFallbackIcon(state);
	}
}

function createFallbackIcon(state) {
	const size = 16;
	const canvas = Buffer.alloc(size * size * 4);
	const color = state === 'connected' ? [0x22, 0xC5, 0x5E, 0xFF]  // Grün
		: state === 'connecting' ? [0xF5, 0x9E, 0x0B, 0xFF]          // Gelb
		: [0x6B, 0x72, 0x80, 0xFF];                                   // Grau
	
	for (let i = 0; i < size * size; i++) {
		const x = i % size;
		const y = Math.floor(i / size);
		const cx = size / 2;
		const cy = size / 2;
		const r = size / 2 - 1;
		if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) {
			canvas.set(color, i * 4);
		}
	}
	
	return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function updateTray(state) {
	if (!tray) return;
	
	tray.setImage(getIcon(state));
	
	const statusText = state === 'connected' ? 'Verbunden'
		: state === 'connecting' ? 'Verbinde...'
		: 'Getrennt';
	
	let tooltip = `GateControl – ${statusText}`;
	if (tunnelState.connected) {
		const serverUrl = store.get('server.url', '');
		if (serverUrl) tooltip += `\n${serverUrl}`;
		if (tunnelState.connectedSince) {
			const dur = Math.floor((Date.now() - new Date(tunnelState.connectedSince).getTime()) / 1000);
			const h = Math.floor(dur / 3600);
			const m = Math.floor((dur % 3600) / 60);
			tooltip += `\nVerbunden seit: ${h > 0 ? h + 'h ' : ''}${m}m`;
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
			label: state === 'connected' ? '⬤ Verbunden' : '○ Getrennt',
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
			label: state === 'connected' ? 'Trennen' : 'Verbinden',
			click: () => state === 'connected' ? disconnectTunnel() : connectTunnel(),
		},
		{ type: 'separator' },
		{
			label: 'Kill-Switch',
			type: 'checkbox',
			checked: store.get('tunnel.killSwitch', false),
			click: (item) => toggleKillSwitch(item.checked),
		},
		{ type: 'separator' },
		{
			label: 'Fenster öffnen',
			click: () => showWindow(),
		},
		{
			label: 'Einstellungen',
			click: () => {
				showWindow();
				mainWindow?.webContents.send('navigate', 'settings');
			},
		},
		...(pendingUpdate ? [
			{ type: 'separator' },
			{
				label: `⬆ Update v${pendingUpdate.version} installieren`,
				click: () => installUpdate(),
			},
		] : []),
		{ type: 'separator' },
		{
			label: 'Beenden',
			click: () => quitApp(),
		},
	]);
	
	tray.setContextMenu(contextMenu);
}

// ── Fenster ──────────────────────────────────────────────────
function createWindow() {
	mainWindow = new BrowserWindow({
		width: Math.round(590 / screen.getPrimaryDisplay().scaleFactor),
		maxWidth: Math.round(590 / screen.getPrimaryDisplay().scaleFactor),
		height: Math.round((store.get('app.windowHeight', 720)) / screen.getPrimaryDisplay().scaleFactor),
		minHeight: Math.round(500 / screen.getPrimaryDisplay().scaleFactor),
		resizable: true,
		frame: false,
		transparent: true,
		titleBarStyle: 'hidden',
		show: false,
		icon: getIcon('disconnected'),
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
		const physicalHeight = Math.round(height * screen.getPrimaryDisplay().scaleFactor);
		store.set('app.windowHeight', physicalHeight);
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
	try {
		log.info('Tunnel-Verbindung wird aufgebaut...');
		updateTray('connecting');
		broadcastState('connecting');

		// Config vom Server holen falls konfiguriert
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
		
		// Kill-Switch aktivieren (vor Tunnelaufbau!)
		if (store.get('tunnel.killSwitch', false)) {
			await killSwitch.enable(WG_CONFIG_FILE);
			log.info('Kill-Switch aktiviert');
		}
		
		// Tunnel starten
		await wgService.connect(WG_CONFIG_FILE, store.get('tunnel.splitTunnel') ? store.get('tunnel.splitRoutes', '') : null);
		
		tunnelState.connected = true;
		tunnelState.connectedSince = new Date();
		
		updateTray('connected');
		broadcastState('connected');
		
		// Monitoring starten
		connectionMonitor.start();
		
		showNotification('Verbunden', 'GateControl VPN-Tunnel ist aktiv.');
		log.info('Tunnel erfolgreich verbunden');

		// Peer-Ablauf prüfen
		checkPeerExpiry();
		
	} catch (err) {
		log.error('Tunnel-Verbindung fehlgeschlagen:', err);
		updateTray('disconnected');
		broadcastState('error', err.message);
		showNotification('Verbindungsfehler', err.message);
	}
}

async function disconnectTunnel() {
	try {
		log.info('Tunnel wird getrennt...');
		
		connectionMonitor.stop();
		
		await wgService.disconnect();
		
		// Kill-Switch deaktivieren
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
		
		showNotification('Getrennt', 'VPN-Tunnel wurde beendet.');
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

// ── Reconnect Logic ──────────────────────────────────────────
async function handleDisconnect() {
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
			updateTray('connected');
			broadcastState('connected');
			connectionMonitor.start();
			
			showNotification('Wiederverbunden', 'VPN-Tunnel wurde wiederhergestellt.');
			log.info('Reconnect erfolgreich');
			return;
		} catch (err) {
			log.warn(`Reconnect-Versuch ${i + 1} fehlgeschlagen:`, err.message);
		}
	}
	
	log.error('Alle Reconnect-Versuche fehlgeschlagen');
	updateTray('disconnected');
	broadcastState('error', 'Reconnect fehlgeschlagen. Bitte manuell verbinden.');
	showNotification('Verbindung verloren', 'Automatischer Reconnect fehlgeschlagen.');
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
			showNotification('Peer abgelaufen', 'Dein VPN-Zugang ist abgelaufen. Kontaktiere den Administrator.');
			mainWindow?.webContents.send('peer-expiry', { daysLeft: 0, expiresAt: peerInfo.expiresAt });
		} else if (daysLeft <= 1) {
			showNotification('Peer läuft heute ab', 'Dein VPN-Zugang läuft in weniger als 24 Stunden ab.');
			mainWindow?.webContents.send('peer-expiry', { daysLeft, expiresAt: peerInfo.expiresAt });
		} else if (daysLeft <= 3) {
			showNotification('Peer läuft bald ab', `Dein VPN-Zugang läuft in ${daysLeft} Tagen ab.`);
			mainWindow?.webContents.send('peer-expiry', { daysLeft, expiresAt: peerInfo.expiresAt });
		} else if (daysLeft <= 7) {
			showNotification('Peer-Ablauf Hinweis', `Dein VPN-Zugang läuft in ${daysLeft} Tagen ab.`);
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
	showNotification('Update verfügbar', `Version ${release.version} wurde heruntergeladen.`);
	mainWindow?.webContents.send('update-ready', {
		version: release.version,
		releaseNotes: release.releaseNotes,
	});
}

async function installUpdate() {
	if (!pendingUpdate || !updater?.isUpdateReady()) return false;

	log.info('Update-Installation gestartet...');

	// Tunnel sicher trennen
	if (tunnelState.connected) {
		await disconnectTunnel();
	}

	// Kill-Switch deaktivieren
	if (store.get('tunnel.killSwitch', false)) {
		try {
			await killSwitch.disable();
			store.set('tunnel.killSwitch', false);
		} catch {}
	}

	// Installer starten
	updater.install();

	// App beenden
	setTimeout(() => quitApp(), 1500);
	return true;
}

// ── IPC Renderer ↔ Main ─────────────────────────────────────
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
	};
	
	mainWindow?.webContents.send('tunnel-state', state);
}

function registerIpcHandlers() {
	// Tunnel-Steuerung
	ipcMain.handle('app:version', () => app.getVersion());
	ipcMain.handle('tunnel:connect', () => connectTunnel());
	ipcMain.handle('tunnel:disconnect', () => disconnectTunnel());
	ipcMain.handle('tunnel:status', () => ({
		...tunnelState,
		endpoint: store.get('server.url', '') || tunnelState.endpoint,
		killSwitch: store.get('tunnel.killSwitch', false),
	}));
	
	// Update
	ipcMain.handle('update:check', () => updater?.getUpdateInfo());
	ipcMain.handle('update:install', () => installUpdate());

	// Services & DNS-Leak-Test
	ipcMain.handle('services:list', () => apiClient?.getServices());
	ipcMain.handle('traffic:stats', () => apiClient?.getTraffic());
	ipcMain.handle('dns:leak-test', async () => {
		const dns = require('dns').promises;
		const results = { passed: false, dnsServers: [], vpnCheck: null };

		try {
			// 1. Aktuelle DNS-Server prüfen (über Tunnel-Interface)
			const resolvers = dns.getServers();
			results.dnsServers = resolvers;

			// 2. Bekannte Domain auflösen und prüfen ob es durch VPN geht
			const serverCheck = await apiClient?.dnsCheck();
			results.vpnCheck = serverCheck;

			// 3. Prüfen ob die Client-IP im VPN-Subnetz liegt
			if (serverCheck?.vpnSubnet && serverCheck?.serverIp) {
				const subnet = serverCheck.vpnSubnet.split('/')[0].split('.').slice(0, 3).join('.');
				const clientIp = serverCheck.serverIp;
				results.passed = clientIp.startsWith(subnet) || clientIp.startsWith('10.') || clientIp === '127.0.0.1';
			}
		} catch (err) {
			log.debug('DNS-Leak-Test fehlgeschlagen:', err.message);
		}

		return results;
	});

	// Konfiguration
	ipcMain.handle('config:get', (_, key) => store.get(key));
	ipcMain.handle('config:set', (_, key, value) => store.set(key, value));
	ipcMain.handle('config:getAll', () => store.store);
	
	// Server-Einstellungen
	ipcMain.handle('server:setup', async (_, { url, apiKey }) => {
		store.set('server.url', url);
		store.set('server.apiKey', apiKey);
		apiClient.configure(url, apiKey);
		updater?.configure(url, apiKey);

		try {
			// Erst Ping testen
			await apiClient.ping();

			// Dann registrieren
			const info = await apiClient.register();
			store.set('server.peerId', String(info.peerId));
			apiClient.setPeerId(info.peerId);
			return { success: true, peerId: info.peerId };
		} catch (err) {
			return { success: false, error: err.message };
		}
	});
	
	ipcMain.handle('server:test', async () => {
		try {
			await apiClient.ping();
			return { success: true };
		} catch (err) {
			return { success: false, error: err.message };
		}
	});
	
	// Config-Import
	ipcMain.handle('config:import-file', async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			title: 'WireGuard-Konfiguration importieren',
			filters: [
				{ name: 'WireGuard Config', extensions: ['conf'] },
				{ name: 'Alle Dateien', extensions: ['*'] },
			],
			properties: ['openFile'],
		});
		
		if (result.canceled) return { success: false };
		
		try {
			const fs = require('fs').promises;
			const content = await fs.readFile(result.filePaths[0], 'utf-8');
			await wgService.writeConfig(WG_CONFIG_FILE, content);
			return { success: true, path: result.filePaths[0] };
		} catch (err) {
			return { success: false, error: err.message };
		}
	});
	
	ipcMain.handle('config:import-qr', async (_, imageData) => {
		try {
			const jsQR = require('jsqr');
			const { data, width, height } = imageData;
			const code = jsQR(new Uint8ClampedArray(data), width, height);
			
			if (!code) return { success: false, error: 'Kein QR-Code erkannt' };
			
			await wgService.writeConfig(WG_CONFIG_FILE, code.data);
			return { success: true, config: code.data };
		} catch (err) {
			return { success: false, error: err.message };
		}
	});
	
	// WireGuard pruefen/installieren
	ipcMain.handle('wireguard:check', async () => {
		return { installed: true, version: 'wireguard-nt (embedded)' };
	});

	// Kill-Switch
	ipcMain.handle('killswitch:toggle', (_, enabled) => toggleKillSwitch(enabled));
	
	// Fenster-Steuerung
	ipcMain.on('window:minimize', () => mainWindow?.minimize());
	ipcMain.on('window:close', () => mainWindow?.hide());
	
	// Autostart
	ipcMain.handle('autostart:set', (_, enabled) => {
		store.set('app.startWithWindows', enabled);
		app.setLoginItemSettings({
			openAtLogin: enabled,
			path: process.execPath,
			args: ['--minimized'],
		});
		return enabled;
	});
	
	// Shell
	ipcMain.handle('shell:open-external', (_, url) => {
		const { shell } = require('electron');
		// Nur http/https URLs zulassen
		if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
			shell.openExternal(url);
		}
	});

	// Logs
	ipcMain.handle('logs:get', async () => {
		const fs = require('fs').promises;
		try {
			const logPath = log.transports.file.getFile().path;
			const content = await fs.readFile(logPath, 'utf-8');
			const lines = content.split('\n').slice(-200);
			return lines.join('\n');
		} catch {
			return 'Keine Logs verfügbar';
		}
	});
}

// ── App Lifecycle ────────────────────────────────────────────
async function initServices() {
	const fs = require('fs');
	if (!fs.existsSync(WG_CONFIG_DIR)) {
		fs.mkdirSync(WG_CONFIG_DIR, { recursive: true });
	}
	
	wgService = new WireGuardService(log);
	killSwitch = new KillSwitch(log);
	apiClient = new ApiClient(
		store.get('server.url', ''),
		store.get('server.apiKey', ''),
		log,
		store.get('server.peerId', '') || null
	);
	
	connectionMonitor = new ConnectionMonitor({
		interval: store.get('app.checkInterval', 30) * 1000,
		onDisconnect: handleDisconnect,
		onStats: (stats) => {
			// Bandbreite berechnen (Bytes/s)
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
}

app.whenReady().then(async () => {
	app.setAppUserModelId('GateControl Client');
	log.info('GateControl Client wird gestartet...');
	
	// Services initialisieren
	await initServices();
	
	// IPC Handler registrieren
	registerIpcHandlers();
	
	// Tray erstellen
	tray = new Tray(getIcon('disconnected'));
	tray.on('double-click', () => showWindow());
	updateTray('disconnected');
	
	// Fenster erstellen
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
	
	// Config-Polling starten
	const pollInterval = store.get('app.configPollInterval', 300) * 1000;
	if (store.get('server.url', '')) {
		setInterval(async () => {
			try {
				const newConfig = await apiClient.checkConfigUpdate();
				if (newConfig) {
					log.info('Neue Konfiguration vom Server erhalten');
					await wgService.writeConfig(WG_CONFIG_FILE, newConfig);
					if (tunnelState.connected) {
						await disconnectTunnel();
						await connectTunnel();
					}
				}
			} catch (err) {
				log.debug('Config-Poll fehlgeschlagen:', err.message);
			}
		}, pollInterval);
	}
	
	// Auto-Update starten
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

	// Autostart konfigurieren
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
	
	if (tunnelState.connected) {
		await disconnectTunnel();
	}
	
	tray?.destroy();
	app.quit();
}

app.on('before-quit', async () => {
	app.isQuitting = true;
});
