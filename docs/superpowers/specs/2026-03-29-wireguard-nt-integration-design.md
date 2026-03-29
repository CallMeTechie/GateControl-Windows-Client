# Design: WireGuard-nt Embedded Integration

**Datum:** 2026-03-29
**Status:** Genehmigt
**Ziel:** WireGuard-Installation als externe Dependency eliminieren — stattdessen wireguard-nt und wintun als gebundelte DLLs direkt aus der Electron-App laden.

---

## Motivation

Der aktuelle Windows-Client erfordert eine separate WireGuard-Installation (`wireguard.exe` + `wg.exe`). Das erzeugt:
- Schlechte UX (Auto-Download, Silent-Install, Fehlerzustände)
- Abhängigkeit von externer Software und deren Installationspfaden
- Drei Fallback-Strategien für Tunnel-Start (Service Install → SC Manager → wg CLI)
- 179 Zeilen Installer-Code + 412 Zeilen CLI-Wrapper

## Lösung

**wireguard-nt** (`wireguard.dll`, Apache 2.0) + **wintun** (`wintun.dll`) werden direkt im App-Bundle mitgeliefert und via **koffi** (FFI-Library) aus JavaScript aufgerufen.

---

## Architektur

### DLL-Bundling

```
resources/
├── icons/
└── bin/
    ├── wireguard.dll    (~200KB, wireguard-nt, von GitHub Release)
    └── wintun.dll       (~400KB, TUN-Adapter, von wintun.net)
```

- Auslieferung via `extraResources` in electron-builder Config
- Laufzeit-Pfad: `process.resourcesPath/resources/bin/`
- `wintun.dll` muss im selben Verzeichnis wie `wireguard.dll` liegen (wird automatisch geladen)

### Neuer Service: `wireguard-native.js`

Ersetzt `wireguard.js` komplett. Gleiche öffentliche API-Oberfläche.

**Öffentliche Methoden:**

| Methode | Beschreibung |
|---------|-------------|
| `constructor(log)` | Logger setzen, DLL-Pfade auflösen |
| `connect(configPath)` | Config parsen, Adapter erstellen, Config setzen, IP zuweisen, aktivieren |
| `disconnect()` | Deaktivieren, Adapter schließen, IP-Konfiguration entfernen |
| `isConnected()` | Adapter-State prüfen via `WireGuardGetAdapterState` |
| `getStats()` | `WireGuardGetConfiguration` → Peer-Stats parsen (RxBytes, TxBytes, LastHandshake) |
| `isInstalled()` | Immer `true` (DLLs sind gebundelt) |
| `getVersion()` | Gibt `'wireguard-nt (embedded)'` zurück |
| `writeConfig(path, content)` | Config-Datei schreiben (unverändert) |
| `readConfig(path)` | Config-Datei lesen (unverändert) |

**Entfallende Methoden:**
- `ensureInstalled()` — nicht mehr nötig
- `_detectPaths()` — nicht mehr nötig
- `_startViaServiceManager()` — kein Windows Service mehr
- `_startViaWgQuick()` — kein CLI-Fallback mehr
- `_waitForConnection()` — Adapter-Aktivierung ist synchron

### wireguard-nt API-Funktionen (via koffi)

```
WireGuardCreateAdapter(name, tunnelType, requestedGUID) → AdapterHandle
WireGuardOpenAdapter(name) → AdapterHandle
WireGuardCloseAdapter(adapter)
WireGuardGetAdapterState(adapter) → WIREGUARD_ADAPTER_STATE
WireGuardSetAdapterState(adapter, state)
WireGuardSetConfiguration(adapter, config, configSize) → BOOL
WireGuardGetConfiguration(adapter, config, configSize) → BOOL
WireGuardDeleteDriver()
```

### Binäre Struct-Definitionen (koffi)

```js
WireGuardInterface {
  Flags: uint32,
  ListenPort: uint16,
  PrivateKey: uint8[32],
  PublicKey: uint8[32],
  PeersCount: uint32
}

WireGuardPeer {
  Flags: uint32,
  Reserved: uint32,
  PublicKey: uint8[32],
  PresharedKey: uint8[32],
  PersistentKeepalive: uint16,
  Endpoint: SOCKADDR_INET,  // Union: { sin_family, sin_port, sin_addr } für IPv4
  RxBytes: uint64,
  TxBytes: uint64,
  LastHandshake: uint64,
  AllowedIPsCount: uint32
}

WireGuardAllowedIP {
  Address: IN_ADDR | IN6_ADDR,  // 4 Bytes (IPv4) oder 16 Bytes (IPv6), via AddressFamily
  AddressFamily: uint16,
  Cidr: uint8
}
```

### Connect-Flow

1. `.conf`-Datei parsen (bestehender `_parseConfig()`)
2. Keys: Base64 → 32-Byte Buffer
3. Endpoint: String → `SOCKADDR_INET`
4. AllowedIPs → `WireGuardAllowedIP`-Array
5. Buffer zusammenbauen (Interface + Peers + AllowedIPs, zusammenhängend)
6. `WireGuardCreateAdapter("gatecontrol0", "GateControl", null)`
7. `WireGuardSetConfiguration(adapter, buffer, size)`
8. `WireGuardSetAdapterState(adapter, WIREGUARD_ADAPTER_STATE_UP)`
9. IP-Adresse + DNS via `netsh`:
   ```
   netsh interface ip set address "gatecontrol0" static <ip> <mask>
   netsh interface ip set dns "gatecontrol0" static <dns>
   ```

### Disconnect-Flow

1. `WireGuardSetAdapterState(adapter, WIREGUARD_ADAPTER_STATE_DOWN)`
2. `WireGuardCloseAdapter(adapter)`
3. Adapter-Handle auf `null` setzen

### Stats-Flow (getStats)

1. `WireGuardGetConfiguration(adapter, &buffer, &size)`
2. Buffer → JS-Objekte parsen
3. Aus Peer-Struct: `RxBytes`, `TxBytes`, `LastHandshake`
4. Rückgabe im gleichen Format wie bisher:
   ```js
   { connected, endpoint, handshake, handshakeTimestamp, rxBytes, txBytes, peers }
   ```

---

## Änderungen an bestehenden Dateien

### `main.js`
- Import: `WireGuardService` → `WireGuardNative`
- `connectTunnel()`: `ensureInstalled()`-Block entfernen (Zeilen 255-271)
- `broadcastState('installing_wireguard')` entfällt
- IPC `wireguard:install` entfernen
- IPC `wireguard:check` vereinfachen auf `{ installed: true, version: 'wireguard-nt' }`

### `preload.js`
- `wireguard.install` entfernen
- `wireguard.onInstallProgress` entfernen
- `wireguard.check` bleibt (gibt immer embedded-Status zurück)

### `package.json`
- Neue Dependency: `koffi`
- Entfernen: `sudo-prompt` (nicht mehr gebraucht)
- `extraResources`: `resources/bin/` hinzufügen (DLLs)

### `renderer.js` / `index.html`
- WireGuard-Installationshinweis entfernen
- Install-Progress-Anzeige entfernen

### `scripts/installer.nsh`
- WireGuard-Tunnel-Service-Cleanup entfällt
- Optional: wintun-Adapter-Cleanup bei Uninstall

## Dateien die entfallen

| Datei | Zeilen | Grund |
|-------|--------|-------|
| `src/services/wireguard-installer.js` | 179 | Keine externe Installation mehr nötig |
| `src/services/wireguard.js` | 412 | Ersetzt durch `wireguard-native.js` |

## Unveränderte Dateien

| Datei | Grund |
|-------|-------|
| `src/services/killswitch.js` | Nutzt weiterhin `netsh advfirewall`, keine WireGuard-Abhängigkeit |
| `src/services/connection-monitor.js` | Ruft nur `wgService.getStats()` auf, Interface unverändert |
| `src/services/api-client.js` | Keine WireGuard-Abhängigkeit |

---

## Dependencies

| Paket | Version | Zweck |
|-------|---------|-------|
| `koffi` | `^2.9` | FFI für DLL-Aufrufe, Electron-kompatibel, Pre-builds |

| Entfernt | Grund |
|----------|-------|
| `sudo-prompt` | War für WireGuard-Installation, nicht mehr nötig |

## DLL-Quellen

| DLL | Quelle | Lizenz |
|-----|--------|--------|
| `wireguard.dll` | https://git.zx2c4.com/wireguard-nt/about/ (offizielles Repo) | Apache 2.0 |
| `wintun.dll` | https://www.wintun.net/ | GPL + Redistribution-Ausnahme für Bundling |

## Risiken

1. **Struct-Alignment:** wireguard-nt erwartet packed Structs. koffi muss korrekt aligned werden — Tests auf x64 Windows nötig.
2. **Electron-Kompatibilität:** koffi muss für die Electron-Node-Version passen. `electron-rebuild` oder Pre-build nötig.
3. **Admin-Rechte:** Adapter-Erstellung erfordert Admin. App hat bereits `requestedExecutionLevel: requireAdministrator`.
4. **wintun Treiber-Installation:** Beim ersten `WireGuardCreateAdapter`-Aufruf installiert wireguard-nt den wintun-Treiber automatisch. Danach persistent bis Deinstallation.
