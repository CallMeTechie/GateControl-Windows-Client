# GateControl Windows Client

Electron-basierter WireGuard VPN-Client mit nativer WireGuard-Integration (FFI), Tray-Icon, Auto-Connect, Kill-Switch und Server-Anbindung an [GateControl](https://github.com/CallMeTechie/gatecontrol).

## Features

| Feature | Beschreibung |
|---------|-------------|
| **Native WireGuard** | Direkte FFI-Anbindung an `wireguard.dll` / `wintun.dll` via Koffi |
| **Auto-Connect** | Verbindet beim Windows-Start automatisch |
| **Auto-Update** | Prüft automatisch auf neue Versionen, stiller Download, Update-Banner |
| **Kill-Switch** | Blockiert allen Traffic außerhalb des VPN-Tunnels (Windows Firewall) |
| **Erreichbare Dienste** | Zeigt alle Server-Routen als klickbare Liste nach Verbindungsaufbau |
| **DNS-Leak-Test** | Prüft ob DNS-Anfragen durch den VPN-Tunnel gehen |
| **Tray-Icon** | Status-Anzeige mit Kontextmenü und Versionsanzeige (grün/gelb/grau) |
| **Config-Import** | Per `.conf`-Datei oder QR-Code (Webcam) |
| **Server-Integration** | Config-Pull, automatische Updates, Heartbeat & Status-Reporting |
| **Auto-Reconnect** | Exponential Backoff bei Verbindungsabbruch (2s → 60s, max 10 Versuche) |
| **Traffic-Statistiken** | Echtzeit RX/TX, Handshake-Alter, Server-URL-Anzeige |

## Voraussetzungen

- **Windows 10/11** (64-Bit)
- **Administrator-Rechte** (für WireGuard-Adapter und Firewall-Regeln)
- **Node.js 20+** (nur für Entwicklung)
- **GateControl Server** mit API-Token (Scope: `client`)

> **Hinweis:** WireGuard muss **nicht** separat installiert werden. Die benötigten DLLs (`wireguard.dll`, `wintun.dll`) sind in `resources/bin/` eingebettet.

## Schnellstart

### Installation (Endbenutzer)

1. `GateControl Setup.exe` herunterladen und installieren
2. App starten (läuft als Administrator)
3. Unter **Settings**: Server-URL und API-Key eingeben
4. **Test Connection** → **Save & Register**
5. Auf der Status-Seite **Connect** drücken

### API-Token erstellen

Im GateControl Web-UI unter **Settings → API Tokens**:

- **Name:** z.B. `Windows Client`
- **Scope:** `Client App` (unter Integration)
- Token kopieren und im Client eingeben

## Entwicklung

```powershell
git clone https://github.com/CallMeTechie/GateControl-Windows-Client.git
cd GateControl-Windows-Client

npm install

# Entwicklungsmodus
npm run dev

# Produktions-Start
npm start
```

## Build

```powershell
# NSIS Installer (.exe)
npm run build:installer

# Portable Version (.zip)
npm run build:portable

# Standard Build
npm run build

# Output in ./dist/
```

## Architektur

```
┌──────────────────────────────────────────────────────┐
│  Electron App                                        │
│                                                      │
│   Renderer (UI)          Main Process                │
│  ┌──────────────┐       ┌────────────────────────┐   │
│  │  Status       │  IPC  │  WireGuard Service     │   │
│  │  Settings     │◄────►│  → wireguard.dll (FFI) │   │
│  │  Logs         │       │  → wintun.dll          │   │
│  └──────────────┘       ├────────────────────────┤   │
│                          │  Kill-Switch            │   │
│   preload.js             │  → netsh (Firewall)    │   │
│   (Context Bridge)       ├────────────────────────┤   │
│                          │  API Client             │   │
│                          │  → /api/v1/client/*    │   │
│                          ├────────────────────────┤   │
│                          │  Connection Monitor     │   │
│                          │  → Handshake + Reconnect│   │
│                          └────────────────────────┘   │
└──────────────────────────────────────────────────────┘
                            │
                            ▼
              ┌──────────────────────────┐
              │  GateControl Server      │
              │  (WireGuard + Caddy)     │
              └──────────────────────────┘
```

## Projektstruktur

```
GateControl-Windows-Client/
├── package.json
├── build/
│   └── icon.ico                    # App-Icon (Multi-Resolution)
├── resources/
│   ├── bin/
│   │   ├── wireguard.dll           # WireGuard-NT Library
│   │   └── wintun.dll              # Wintun TUN-Adapter
│   └── icons/
│       ├── tray-connected.png      # Grün (16x16)
│       ├── tray-connecting.png     # Gelb (16x16)
│       └── tray-disconnected.png   # Grau (16x16)
├── scripts/
│   └── installer.nsh               # NSIS Installer-Anpassungen
├── src/
│   ├── main/
│   │   ├── main.js                 # Electron Main Process
│   │   └── preload.js              # Context Bridge (IPC Security)
│   ├── renderer/
│   │   ├── index.html              # UI Markup
│   │   ├── renderer.js             # UI Logik & State
│   │   └── styles/
│   │       └── app.css             # Design System (Dark Theme)
│   └── services/
│       ├── wireguard-native.js     # WireGuard FFI (Koffi)
│       ├── api-client.js           # GateControl Server API
│       ├── killswitch.js           # Windows Firewall Kill-Switch
│       └── connection-monitor.js   # Verbindungsüberwachung
└── dist/                           # Build Output
```

## Server-API

Der Client kommuniziert ausschließlich über `/api/v1/client/*` Endpoints:

| Endpoint | Methode | Funktion |
|----------|---------|----------|
| `/api/v1/client/ping` | GET | Verbindungstest |
| `/api/v1/client/register` | POST | Client als Peer registrieren |
| `/api/v1/client/config` | GET | WireGuard-Konfiguration abrufen |
| `/api/v1/client/config/check` | GET | Config-Update prüfen (Hash-Vergleich) |
| `/api/v1/client/heartbeat` | POST | Status & Traffic-Statistiken senden |
| `/api/v1/client/status` | POST | Verbindungsstatus melden |

### Authentifizierung

```
X-API-Token: gc_xxxxxxxxxxxxxxxxxxxxxxxx
X-Client-Version: 1.0.0
X-Client-Platform: windows
```

Benötigter Token-Scope: **`client`** (oder `full-access`)

## Kill-Switch

Erstellt Windows-Firewall-Regeln (Whitelist-Ansatz):

| Regel | Richtung | Aktion |
|-------|----------|--------|
| Loopback (127.0.0.0/8) | Out | Allow |
| LAN (10/8, 172.16/12, 192.168/16) | Out | Allow |
| WireGuard Endpoint (UDP) | Out | Allow |
| VPN-Subnetz | Out | Allow |
| DHCP (UDP 67/68) | Out | Allow |
| Alles andere | In + Out | Block |

Alle Regeln tragen den Prefix `GateControl_KS_` und werden beim Deaktivieren oder Deinstallieren vollständig entfernt.

## Konfiguration

### Speicherorte

| Datei | Pfad |
|-------|------|
| App-Config (verschlüsselt) | `%APPDATA%/gatecontrol-client/gatecontrol-config.json` |
| WireGuard-Config | `%APPDATA%/gatecontrol-client/wireguard/gatecontrol0.conf` |
| Logs | `%APPDATA%/gatecontrol-client/logs/main.log` |
| Autostart | Registry: `HKCU\...\Run\GateControl` |

### App-Einstellungen

| Option | Standard | Beschreibung |
|--------|----------|-------------|
| Auto-Connect | An | Verbindet beim App-Start |
| Kill-Switch | Aus | Blockiert Non-VPN-Traffic |
| Start minimiert | An | Startet im Tray |
| Windows-Autostart | An | Startet mit Windows |
| Check-Intervall | 30s | Verbindungsprüfung |
| Config-Polling | 300s | Server-Config-Update |

## Tray-Icon

| Zustand | Farbe | Bedeutung |
|---------|-------|-----------|
| Getrennt | Grau | Kein aktiver Tunnel |
| Verbinde | Gelb | Tunnel wird aufgebaut / Reconnect |
| Verbunden | Grün | Tunnel aktiv, Handshake OK |

## Technologie-Stack

| Komponente | Technologie | Version |
|-----------|------------|---------|
| Framework | Electron | 30.0.0 |
| VPN | WireGuard-NT (FFI) | via Koffi 2.9 |
| HTTP | Axios | 1.7 |
| Storage | electron-store | 8.2 (verschlüsselt) |
| Logging | electron-log | 5.1 |
| QR-Scanner | jsqr | 1.4 |
| Build | electron-builder | 24.13 (NSIS) |

## Lizenz

MIT
