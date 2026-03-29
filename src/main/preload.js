/**
 * GateControl – Preload Script
 * Sichere Bridge zwischen Main und Renderer Process
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gatecontrol', {
	// ── Tunnel ───────────────────────────────────────────
	tunnel: {
		connect:    () => ipcRenderer.invoke('tunnel:connect'),
		disconnect: () => ipcRenderer.invoke('tunnel:disconnect'),
		getStatus:  () => ipcRenderer.invoke('tunnel:status'),
		onState:    (cb) => {
			const handler = (_, state) => cb(state);
			ipcRenderer.on('tunnel-state', handler);
			return () => ipcRenderer.removeListener('tunnel-state', handler);
		},
	},
	
	// ── Server ───────────────────────────────────────────
	server: {
		setup: (opts) => ipcRenderer.invoke('server:setup', opts),
		test:  ()     => ipcRenderer.invoke('server:test'),
	},
	
	// ── Config ───────────────────────────────────────────
	config: {
		get:        (key)        => ipcRenderer.invoke('config:get', key),
		set:        (key, value) => ipcRenderer.invoke('config:set', key, value),
		getAll:     ()           => ipcRenderer.invoke('config:getAll'),
		importFile: ()           => ipcRenderer.invoke('config:import-file'),
		importQR:   (imageData)  => ipcRenderer.invoke('config:import-qr', imageData),
	},
	
	// ── WireGuard ────────────────────────────────────────
	wireguard: {
		check: () => ipcRenderer.invoke('wireguard:check'),
	},

	// ── Kill-Switch ──────────────────────────────────────
	killSwitch: {
		toggle: (enabled) => ipcRenderer.invoke('killswitch:toggle', enabled),
	},
	
	// ── Autostart ────────────────────────────────────────
	autostart: {
		set: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
	},
	
	// ── Logs ─────────────────────────────────────────────
	logs: {
		get: () => ipcRenderer.invoke('logs:get'),
	},
	
	// ── Fenster ──────────────────────────────────────────
	window: {
		minimize: () => ipcRenderer.send('window:minimize'),
		close:    () => ipcRenderer.send('window:close'),
	},
	
	// ── Navigation ───────────────────────────────────────
	onNavigate: (cb) => {
		const handler = (_, page) => cb(page);
		ipcRenderer.on('navigate', handler);
		return () => ipcRenderer.removeListener('navigate', handler);
	},
});
