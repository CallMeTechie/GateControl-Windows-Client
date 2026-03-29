# WireGuard-nt Embedded Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace external WireGuard dependency with embedded wireguard-nt DLLs loaded via koffi FFI, eliminating the need for a separate WireGuard installation.

**Architecture:** New `wireguard-native.js` service wraps wireguard-nt C API via koffi FFI. DLLs (`wireguard.dll` + `wintun.dll`) bundled in `resources/bin/`. Same public interface as existing `wireguard.js` so `main.js` and `connection-monitor.js` need minimal changes.

**Tech Stack:** Node.js, Electron 30, koffi (FFI), wireguard-nt (C DLL), wintun (TUN driver DLL)

**Spec:** `docs/superpowers/specs/2026-03-29-wireguard-nt-integration-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/services/wireguard-native.js` | koffi FFI wrapper for wireguard-nt: adapter lifecycle, config, stats |
| Modify | `src/main/main.js` | Switch import, remove install logic |
| Modify | `src/main/preload.js` | Remove wireguard.install + onInstallProgress |
| Modify | `package.json` | Add koffi, remove sudo-prompt, update extraResources |
| Modify | `scripts/installer.nsh` | Remove WireGuard tunnel service cleanup |
| Delete | `src/services/wireguard.js` | Replaced by wireguard-native.js |
| Delete | `src/services/wireguard-installer.js` | No longer needed |
| Unchanged | `src/services/killswitch.js` | No WireGuard dependency |
| Unchanged | `src/services/connection-monitor.js` | Calls wgService.getStats() — interface unchanged |
| Unchanged | `src/services/api-client.js` | No WireGuard dependency |
| Unchanged | `src/renderer/renderer.js` | No wireguard install references in UI |
| Unchanged | `src/renderer/index.html` | No wireguard install elements |

---

### Task 1: Add koffi dependency and DLL placeholders

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add koffi dependency, remove sudo-prompt**

In `package.json`, replace the dependencies block:

```json
"dependencies": {
    "axios": "^1.7.0",
    "electron-store": "^8.2.0",
    "electron-log": "^5.1.0",
    "jsqr": "^1.4.0",
    "koffi": "^2.9.0",
    "node-schedule": "^2.1.1",
    "ws": "^8.16.0"
}
```

Changes: added `koffi`, removed `sudo-prompt`.

- [ ] **Step 2: Add `resources/bin/` to extraResources**

In `package.json` build config, the existing `extraResources` already covers `resources/`:

```json
"extraResources": [
  {
    "from": "resources/",
    "to": "resources/",
    "filter": ["**/*"]
  }
]
```

This already includes `resources/bin/`. No change needed here.

- [ ] **Step 3: Create DLL directory with README**

Create `resources/bin/README.md`:

```markdown
# WireGuard Native DLLs

Place the following DLLs here before building:

- `wireguard.dll` — wireguard-nt (https://git.zx2c4.com/wireguard-nt/about/)
  Download from the official release, select amd64 build.

- `wintun.dll` — Wintun TUN adapter (https://www.wintun.net/)
  Download from the official release, select amd64 build.

Both DLLs must be the x64 (amd64) versions.
```

- [ ] **Step 4: Commit**

```bash
git add package.json resources/bin/README.md
git commit -m "feat: add koffi dependency and DLL placeholder for wireguard-nt"
```

---

### Task 2: Create wireguard-native.js — DLL loading and struct definitions

**Files:**
- Create: `src/services/wireguard-native.js`

- [ ] **Step 1: Create the file with koffi imports, DLL loading, and struct definitions**

```js
/**
 * GateControl – WireGuard Native Service
 *
 * Verwaltet WireGuard-Tunnel direkt über wireguard-nt (wireguard.dll)
 * und wintun (wintun.dll) via koffi FFI. Keine externe WireGuard-
 * Installation erforderlich.
 */

const koffi = require('koffi');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// ── Adapter State Enum ──────────────────────────────────────
const WIREGUARD_STATE_DOWN = 0;
const WIREGUARD_STATE_UP = 1;

// ── Interface/Peer Flags ────────────────────────────────────
const WIREGUARD_INTERFACE_HAS_PUBLIC_KEY = (1 << 0);
const WIREGUARD_INTERFACE_HAS_PRIVATE_KEY = (1 << 1);
const WIREGUARD_INTERFACE_HAS_LISTEN_PORT = (1 << 2);
const WIREGUARD_INTERFACE_REPLACE_PEERS = (1 << 3);

const WIREGUARD_PEER_HAS_PUBLIC_KEY = (1 << 0);
const WIREGUARD_PEER_HAS_PRESHARED_KEY = (1 << 1);
const WIREGUARD_PEER_HAS_PERSISTENT_KEEPALIVE = (1 << 2);
const WIREGUARD_PEER_HAS_ENDPOINT = (1 << 3);
const WIREGUARD_PEER_REPLACE_ALLOWED_IPS = (1 << 5);

// ── SOCKADDR_IN (IPv4 Endpoint) ─────────────────────────────
// 16 bytes: family(2) + port(2) + addr(4) + padding(8)
const SOCKADDR_IN_SIZE = 16;

// ── SOCKADDR_INET union size (covers both IPv4 and IPv6) ────
const SOCKADDR_INET_SIZE = 28;

// ── Struct sizes (packed, no alignment padding) ─────────────
// WireGuardInterface: Flags(4) + ListenPort(2) + PrivateKey(32) + PublicKey(32) + PeersCount(4) = 74
const WG_INTERFACE_SIZE = 74;

// WireGuardPeer: Flags(4) + Reserved(4) + PublicKey(32) + PresharedKey(32)
//   + PersistentKeepalive(2) + Endpoint(28) + RxBytes(8) + TxBytes(8)
//   + LastHandshake(8) + AllowedIPsCount(4) = 130
const WG_PEER_SIZE = 130;

// WireGuardAllowedIP: Address(16 for union) + AddressFamily(2) + Cidr(1) + padding = 20
// Actually: IN_ADDR/IN6_ADDR union(16) + AddressFamily(2) + Cidr(1) + pad(1) = 20
const WG_ALLOWED_IP_SIZE = 20;

class WireGuardNative {
  constructor(log) {
    this.log = log;
    this.tunnelName = 'gatecontrol0';
    this.adapter = null;
    this.lib = null;

    this._loadLibrary();
  }

  /**
   * wireguard.dll laden und Funktionen binden
   */
  _loadLibrary() {
    const { app } = require('electron');
    const resourcesPath = app.isPackaged
      ? path.join(process.resourcesPath, 'resources', 'bin')
      : path.join(__dirname, '..', '..', 'resources', 'bin');

    const dllPath = path.join(resourcesPath, 'wireguard.dll');

    try {
      this.lib = koffi.load(dllPath);
      this.log.info(`wireguard.dll geladen: ${dllPath}`);
    } catch (err) {
      this.log.error(`wireguard.dll konnte nicht geladen werden: ${err.message}`);
      throw new Error(`WireGuard-DLL nicht gefunden: ${dllPath}`);
    }

    // ── Funktionen binden ──────────────────────────────────
    // Adapter handle ist ein opaker Pointer
    const AdapterHandle = koffi.pointer('WIREGUARD_ADAPTER_HANDLE', koffi.opaque());

    this._createAdapter = this.lib.func(
      'void* __stdcall WireGuardCreateAdapter(const char16_t*, const char16_t*, void*)'
    );

    this._closeAdapter = this.lib.func(
      'void __stdcall WireGuardCloseAdapter(void*)'
    );

    this._getAdapterState = this.lib.func(
      'bool __stdcall WireGuardGetAdapterState(void*, _Out_ int*)'
    );

    this._setAdapterState = this.lib.func(
      'bool __stdcall WireGuardSetAdapterState(void*, int)'
    );

    this._setConfiguration = this.lib.func(
      'bool __stdcall WireGuardSetConfiguration(void*, const void*, uint32_t)'
    );

    this._getConfiguration = this.lib.func(
      'bool __stdcall WireGuardGetConfiguration(void*, void*, _Inout_ uint32_t*)'
    );
  }
}

module.exports = WireGuardNative;
```

- [ ] **Step 2: Commit**

```bash
git add src/services/wireguard-native.js
git commit -m "feat(wireguard-native): DLL loading and struct definitions"
```

---

### Task 3: Implement config parsing and binary buffer building

**Files:**
- Modify: `src/services/wireguard-native.js`

- [ ] **Step 1: Add config parsing method**

Add to the `WireGuardNative` class, after the constructor:

```js
  /**
   * WireGuard .conf Datei parsen
   */
  _parseConfig(content) {
    const config = {
      privateKey: null,
      address: null,
      dns: null,
      mtu: null,
      peers: [],
    };

    let currentSection = null;
    let currentPeer = null;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed === '[Interface]') {
        currentSection = 'interface';
        continue;
      }
      if (trimmed === '[Peer]') {
        currentSection = 'peer';
        currentPeer = {};
        config.peers.push(currentPeer);
        continue;
      }

      const match = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
      if (!match) continue;

      const [, key, value] = match;

      if (currentSection === 'interface') {
        if (key === 'PrivateKey') config.privateKey = value.trim();
        if (key === 'Address') config.address = value.trim();
        if (key === 'DNS') config.dns = value.trim();
        if (key === 'MTU') config.mtu = parseInt(value.trim(), 10);
      }

      if (currentSection === 'peer' && currentPeer) {
        currentPeer[key] = value.trim();
      }
    }

    return config;
  }

  /**
   * Base64 Key → 32-Byte Buffer
   */
  _decodeKey(base64Key) {
    const buf = Buffer.from(base64Key, 'base64');
    if (buf.length !== 32) {
      throw new Error(`Ungültiger Key: erwartet 32 Bytes, bekam ${buf.length}`);
    }
    return buf;
  }

  /**
   * Endpoint-String (host:port) → SOCKADDR_IN Buffer (16 Bytes)
   */
  _encodeEndpoint(endpointStr) {
    const buf = Buffer.alloc(SOCKADDR_INET_SIZE, 0);

    if (!endpointStr || endpointStr === '(none)') return buf;

    const match = endpointStr.match(/^(.+):(\d+)$/);
    if (!match) return buf;

    const [, host, portStr] = match;
    const port = parseInt(portStr, 10);

    // AF_INET = 2
    buf.writeUInt16LE(2, 0); // sin_family
    buf.writeUInt16BE(port, 2); // sin_port (network byte order)

    // IPv4-Adresse parsen
    const parts = host.split('.');
    if (parts.length === 4) {
      for (let i = 0; i < 4; i++) {
        buf.writeUInt8(parseInt(parts[i], 10), 4 + i);
      }
    }

    return buf;
  }

  /**
   * AllowedIPs String → Array von Buffers (je WG_ALLOWED_IP_SIZE Bytes)
   */
  _encodeAllowedIPs(allowedIPsStr) {
    const ips = allowedIPsStr.split(',').map(s => s.trim()).filter(Boolean);
    const buffers = [];

    for (const ipCidr of ips) {
      const buf = Buffer.alloc(WG_ALLOWED_IP_SIZE, 0);
      const [addr, cidrStr] = ipCidr.split('/');
      const cidr = parseInt(cidrStr || '32', 10);

      if (addr.includes(':')) {
        // IPv6: AF_INET6 = 23
        // Vereinfacht — für den GateControl-Use-Case reicht IPv4
        buf.writeUInt16LE(23, 16); // AddressFamily
        buf.writeUInt8(cidr, 18); // Cidr
      } else {
        // IPv4
        const parts = addr.split('.');
        for (let i = 0; i < 4; i++) {
          buf.writeUInt8(parseInt(parts[i], 10), i);
        }
        buf.writeUInt16LE(2, 16); // AddressFamily = AF_INET
        buf.writeUInt8(cidr, 18); // Cidr
      }

      buffers.push(buf);
    }

    return buffers;
  }

  /**
   * Parsed config → Binärer Buffer für WireGuardSetConfiguration
   *
   * Layout: [WireGuardInterface][WireGuardPeer][AllowedIP...][WireGuardPeer][AllowedIP...]...
   */
  _buildConfigBuffer(parsed) {
    const peerBuffers = [];

    for (const peer of parsed.peers) {
      const allowedIPs = this._encodeAllowedIPs(peer.AllowedIPs || '0.0.0.0/0');

      // Peer Header
      const peerBuf = Buffer.alloc(WG_PEER_SIZE, 0);
      let flags = WIREGUARD_PEER_HAS_PUBLIC_KEY | WIREGUARD_PEER_REPLACE_ALLOWED_IPS;
      let offset = 0;

      // Endpoint
      if (peer.Endpoint) {
        flags |= WIREGUARD_PEER_HAS_ENDPOINT;
      }

      // PresharedKey
      if (peer.PresharedKey) {
        flags |= WIREGUARD_PEER_HAS_PRESHARED_KEY;
      }

      // PersistentKeepalive
      const keepalive = parseInt(peer.PersistentKeepalive || '0', 10);
      if (keepalive > 0) {
        flags |= WIREGUARD_PEER_HAS_PERSISTENT_KEEPALIVE;
      }

      // Flags (4 bytes)
      peerBuf.writeUInt32LE(flags, offset); offset += 4;
      // Reserved (4 bytes)
      offset += 4;
      // PublicKey (32 bytes)
      this._decodeKey(peer.PublicKey).copy(peerBuf, offset); offset += 32;
      // PresharedKey (32 bytes)
      if (peer.PresharedKey) {
        this._decodeKey(peer.PresharedKey).copy(peerBuf, offset);
      }
      offset += 32;
      // PersistentKeepalive (2 bytes)
      peerBuf.writeUInt16LE(keepalive, offset); offset += 2;
      // Endpoint (SOCKADDR_INET, 28 bytes)
      this._encodeEndpoint(peer.Endpoint).copy(peerBuf, offset); offset += SOCKADDR_INET_SIZE;
      // RxBytes (8), TxBytes (8), LastHandshake (8) — all zero for set
      offset += 24;
      // AllowedIPsCount (4 bytes)
      peerBuf.writeUInt32LE(allowedIPs.length, offset);

      peerBuffers.push({ header: peerBuf, allowedIPs });
    }

    // Interface Header
    const ifaceBuf = Buffer.alloc(WG_INTERFACE_SIZE, 0);
    let ifaceFlags = WIREGUARD_INTERFACE_HAS_PRIVATE_KEY | WIREGUARD_INTERFACE_REPLACE_PEERS;
    let offset = 0;

    // Flags (4 bytes)
    ifaceBuf.writeUInt32LE(ifaceFlags, offset); offset += 4;
    // ListenPort (2 bytes) — 0 = random
    offset += 2;
    // PrivateKey (32 bytes)
    this._decodeKey(parsed.privateKey).copy(ifaceBuf, offset); offset += 32;
    // PublicKey (32 bytes) — derived automatically, leave zero
    offset += 32;
    // PeersCount (4 bytes)
    ifaceBuf.writeUInt32LE(parsed.peers.length, offset);

    // Gesamtbuffer zusammenbauen
    const parts = [ifaceBuf];
    for (const { header, allowedIPs } of peerBuffers) {
      parts.push(header);
      for (const aip of allowedIPs) {
        parts.push(aip);
      }
    }

    return Buffer.concat(parts);
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/services/wireguard-native.js
git commit -m "feat(wireguard-native): config parsing and binary buffer building"
```

---

### Task 4: Implement connect, disconnect, isConnected

**Files:**
- Modify: `src/services/wireguard-native.js`

- [ ] **Step 1: Add connect method**

Add to the `WireGuardNative` class:

```js
  /**
   * Konfigurationsdatei schreiben
   */
  async writeConfig(configPath, content) {
    const dir = path.dirname(configPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(configPath, content, { mode: 0o600 });
    this.log.info(`Config geschrieben: ${configPath}`);
  }

  /**
   * Konfigurationsdatei lesen
   */
  async readConfig(configPath) {
    try {
      return await fs.readFile(configPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Tunnel verbinden
   */
  async connect(configPath) {
    if (!configPath) throw new Error('Kein Konfigurationspfad angegeben');

    // Config lesen und parsen
    const content = await this.readConfig(configPath);
    if (!content) throw new Error(`Konfigurationsdatei nicht gefunden: ${configPath}`);

    const parsed = this._parseConfig(content);
    if (!parsed.privateKey) throw new Error('PrivateKey fehlt in der Konfiguration');
    if (parsed.peers.length === 0) throw new Error('Kein Peer in der Konfiguration');

    // Bestehenden Adapter schließen
    if (this.adapter) {
      try {
        this._closeAdapter(this.adapter);
      } catch { /* ok */ }
      this.adapter = null;
    }

    // Adapter erstellen
    this.log.info(`Erstelle WireGuard-Adapter: ${this.tunnelName}`);
    const nameUtf16 = Buffer.from(this.tunnelName + '\0', 'utf16le');
    const typeUtf16 = Buffer.from('GateControl\0', 'utf16le');

    this.adapter = this._createAdapter(nameUtf16, typeUtf16, null);
    if (!this.adapter) {
      throw new Error('WireGuard-Adapter konnte nicht erstellt werden (Admin-Rechte?)');
    }

    this.log.info('Adapter erstellt, setze Konfiguration...');

    // Konfiguration setzen
    const configBuffer = this._buildConfigBuffer(parsed);
    const success = this._setConfiguration(this.adapter, configBuffer, configBuffer.length);
    if (!success) {
      this._closeAdapter(this.adapter);
      this.adapter = null;
      throw new Error('WireGuard-Konfiguration konnte nicht gesetzt werden');
    }

    // Adapter aktivieren
    const stateSet = this._setAdapterState(this.adapter, WIREGUARD_STATE_UP);
    if (!stateSet) {
      this._closeAdapter(this.adapter);
      this.adapter = null;
      throw new Error('WireGuard-Adapter konnte nicht aktiviert werden');
    }

    // IP-Adresse und DNS konfigurieren
    await this._configureNetwork(parsed);

    this.log.info('Tunnel-Verbindung hergestellt');
  }

  /**
   * IP-Adresse und DNS über netsh konfigurieren
   */
  async _configureNetwork(parsed) {
    if (!parsed.address) return;

    // Address: z.B. "10.8.0.2/24" → IP + Maske
    const addrParts = parsed.address.split(',')[0].trim().split('/');
    const ip = addrParts[0];
    const cidr = parseInt(addrParts[1] || '24', 10);
    const mask = this._cidrToMask(cidr);

    this.log.info(`Konfiguriere Netzwerk: ${ip}/${cidr}`);

    try {
      await execAsync(
        `netsh interface ip set address "${this.tunnelName}" static ${ip} ${mask}`
      );
    } catch (err) {
      this.log.warn(`IP-Konfiguration fehlgeschlagen: ${err.message}`);
    }

    // DNS
    if (parsed.dns) {
      const dnsServers = parsed.dns.split(',').map(s => s.trim());
      try {
        await execAsync(
          `netsh interface ip set dns "${this.tunnelName}" static ${dnsServers[0]}`
        );
        // Weitere DNS-Server hinzufügen
        for (let i = 1; i < dnsServers.length; i++) {
          await execAsync(
            `netsh interface ip add dns "${this.tunnelName}" ${dnsServers[i]} index=${i + 1}`
          );
        }
      } catch (err) {
        this.log.warn(`DNS-Konfiguration fehlgeschlagen: ${err.message}`);
      }
    }

    // Default-Route setzen falls AllowedIPs 0.0.0.0/0 enthält
    const peer = parsed.peers[0];
    if (peer?.AllowedIPs?.includes('0.0.0.0/0')) {
      try {
        await execAsync(
          `netsh interface ip add route 0.0.0.0/0 "${this.tunnelName}" ${ip} metric=5`
        );
      } catch (err) {
        this.log.debug(`Route-Konfiguration: ${err.message}`);
      }
    }
  }

  /**
   * CIDR → Subnet-Maske
   */
  _cidrToMask(cidr) {
    const mask = new Array(4).fill(0);
    for (let i = 0; i < cidr; i++) {
      mask[Math.floor(i / 8)] |= (128 >> (i % 8));
    }
    return mask.join('.');
  }

  /**
   * Tunnel trennen
   */
  async disconnect() {
    this.log.info('Trenne Tunnel...');

    if (this.adapter) {
      try {
        this._setAdapterState(this.adapter, WIREGUARD_STATE_DOWN);
      } catch (err) {
        this.log.debug('Adapter-Deaktivierung:', err.message);
      }

      try {
        this._closeAdapter(this.adapter);
      } catch (err) {
        this.log.debug('Adapter-Close:', err.message);
      }

      this.adapter = null;
    }

    // Netzwerk-Konfiguration aufräumen
    try {
      await execAsync(`netsh interface ip delete address "${this.tunnelName}" addr=0.0.0.0 gateway=all`);
    } catch { /* Interface ggf. schon weg */ }

    this.log.info('Tunnel getrennt');
  }

  /**
   * Prüft ob der Tunnel aktiv ist
   */
  async isConnected() {
    if (!this.adapter) return false;

    try {
      const statePtr = Buffer.alloc(4);
      const result = this._getAdapterState(this.adapter, statePtr);
      if (!result) return false;
      return statePtr.readInt32LE(0) === WIREGUARD_STATE_UP;
    } catch {
      return false;
    }
  }

  /**
   * Immer true — DLLs sind gebundelt
   */
  async isInstalled() {
    return true;
  }

  /**
   * Embedded-Version zurückgeben
   */
  async getVersion() {
    return 'wireguard-nt (embedded)';
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/services/wireguard-native.js
git commit -m "feat(wireguard-native): connect, disconnect, isConnected, network config"
```

---

### Task 5: Implement getStats

**Files:**
- Modify: `src/services/wireguard-native.js`

- [ ] **Step 1: Add getStats and helper methods**

Add to the `WireGuardNative` class:

```js
  /**
   * Tunnel-Statistiken abfragen
   * Gibt das gleiche Format wie der alte WireGuardService zurück
   */
  async getStats() {
    if (!this.adapter) return null;

    try {
      // Buffer für Konfiguration allozieren (großzügig)
      const bufSize = 65536;
      const buf = Buffer.alloc(bufSize);
      const sizePtr = Buffer.alloc(4);
      sizePtr.writeUInt32LE(bufSize, 0);

      const result = this._getConfiguration(this.adapter, buf, sizePtr);
      if (!result) return null;

      const actualSize = sizePtr.readUInt32LE(0);
      return this._parseConfigBuffer(buf.subarray(0, actualSize));
    } catch (err) {
      this.log.debug('Stats-Abfrage fehlgeschlagen:', err.message);
      return null;
    }
  }

  /**
   * Binären Config-Buffer → Stats-Objekt parsen
   */
  _parseConfigBuffer(buf) {
    if (buf.length < WG_INTERFACE_SIZE) return null;

    let offset = 0;

    // Interface Header
    offset += 4; // Flags
    offset += 2; // ListenPort
    offset += 32; // PrivateKey
    const publicKey = buf.subarray(offset, offset + 32);
    offset += 32; // PublicKey
    const peersCount = buf.readUInt32LE(offset);
    offset += 4;

    const peers = [];

    for (let i = 0; i < peersCount; i++) {
      if (offset + WG_PEER_SIZE > buf.length) break;

      const peerStart = offset;
      offset += 4; // Flags
      offset += 4; // Reserved

      // PublicKey
      const peerPubKey = buf.subarray(offset, offset + 32).toString('base64');
      offset += 32;

      // PresharedKey
      const presharedKey = buf.subarray(offset, offset + 32);
      const hasPreshared = !presharedKey.every(b => b === 0);
      offset += 32;

      // PersistentKeepalive
      offset += 2;

      // Endpoint (SOCKADDR_INET)
      const endpointBuf = buf.subarray(offset, offset + SOCKADDR_INET_SIZE);
      const endpoint = this._decodeEndpoint(endpointBuf);
      offset += SOCKADDR_INET_SIZE;

      // RxBytes (uint64)
      const rxBytes = Number(buf.readBigUInt64LE(offset));
      offset += 8;

      // TxBytes (uint64)
      const txBytes = Number(buf.readBigUInt64LE(offset));
      offset += 8;

      // LastHandshake (uint64, Windows FILETIME)
      const lastHandshakeRaw = buf.readBigUInt64LE(offset);
      const lastHandshake = this._filetimeToUnix(lastHandshakeRaw);
      offset += 8;

      // AllowedIPsCount
      const allowedIPsCount = buf.readUInt32LE(offset);
      offset += 4;

      // AllowedIPs überspringen
      offset += allowedIPsCount * WG_ALLOWED_IP_SIZE;

      peers.push({
        publicKey: peerPubKey,
        presharedKey: hasPreshared ? presharedKey.toString('base64') : null,
        endpoint,
        rxBytes,
        txBytes,
        lastHandshake,
        keepalive: 0,
      });
    }

    const peer = peers[0];
    const now = Math.floor(Date.now() / 1000);
    const handshakeAge = peer?.lastHandshake ? now - peer.lastHandshake : null;

    return {
      interface: {
        publicKey: publicKey.toString('base64'),
      },
      peers,
      connected: peer && handshakeAge !== null && handshakeAge < 180,
      endpoint: peer?.endpoint || null,
      handshake: handshakeAge !== null ? this._formatAge(handshakeAge) : null,
      handshakeTimestamp: peer?.lastHandshake || null,
      rxBytes: peer?.rxBytes || 0,
      txBytes: peer?.txBytes || 0,
    };
  }

  /**
   * SOCKADDR_INET Buffer → "host:port" String
   */
  _decodeEndpoint(buf) {
    const family = buf.readUInt16LE(0);
    if (family !== 2) return null; // Nur IPv4

    const port = buf.readUInt16BE(2);
    const ip = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;

    if (ip === '0.0.0.0' && port === 0) return null;
    return `${ip}:${port}`;
  }

  /**
   * Windows FILETIME (100ns seit 1601) → Unix Timestamp (Sekunden)
   */
  _filetimeToUnix(filetime) {
    if (filetime === 0n) return 0;
    // FILETIME-Epoche: 1601-01-01, Unix-Epoche: 1970-01-01
    // Differenz: 11644473600 Sekunden
    const unixTime = Number(filetime / 10000000n) - 11644473600;
    return unixTime > 0 ? unixTime : 0;
  }

  /**
   * Zeitdifferenz formatieren
   */
  _formatAge(seconds) {
    if (seconds < 60) return `vor ${seconds}s`;
    if (seconds < 3600) return `vor ${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `vor ${Math.floor(seconds / 3600)}h`;
    return `vor ${Math.floor(seconds / 86400)}d`;
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/services/wireguard-native.js
git commit -m "feat(wireguard-native): getStats with config buffer parsing"
```

---

### Task 6: Update main.js — switch to wireguard-native

**Files:**
- Modify: `src/main/main.js`

- [ ] **Step 1: Change import**

Replace line 13:

```js
// OLD:
const WireGuardService = require('../services/wireguard');
// NEW:
const WireGuardService = require('../services/wireguard-native');
```

- [ ] **Step 2: Remove WireGuard auto-install logic from connectTunnel()**

In the `connectTunnel()` function (around lines 254-271), remove the entire WireGuard install block:

```js
// REMOVE this entire block (lines 254-271):
		// WireGuard sicherstellen (Auto-Install falls noetig)
		const installed = await wgService.isInstalled();
		if (!installed) {
			log.info('WireGuard nicht gefunden, starte automatische Installation...');
			broadcastState('installing_wireguard');
			showNotification('WireGuard Installation', 'WireGuard wird automatisch installiert...');

			const result = await wgService.ensureInstalled((stage, percent) => {
				log.info(`WireGuard ${stage}: ${percent}%`);
			});

			if (!result.success) {
				throw new Error(`WireGuard-Installation fehlgeschlagen: ${result.message}`);
			}

			showNotification('WireGuard installiert', 'WireGuard wurde erfolgreich installiert.');
			log.info('WireGuard Auto-Installation abgeschlossen');
		}
```

- [ ] **Step 3: Simplify wireguard:check IPC handler**

Replace the `wireguard:check` handler (lines 507-511):

```js
// OLD:
	ipcMain.handle('wireguard:check', async () => {
		const installed = await wgService.isInstalled();
		const version = installed ? await wgService.getVersion() : null;
		return { installed, version };
	});

// NEW:
	ipcMain.handle('wireguard:check', async () => {
		return { installed: true, version: 'wireguard-nt (embedded)' };
	});
```

- [ ] **Step 4: Remove wireguard:install IPC handler**

Remove the entire `wireguard:install` handler (lines 513-522):

```js
// REMOVE:
	ipcMain.handle('wireguard:install', async () => {
		try {
			const result = await wgService.ensureInstalled((stage, percent) => {
				mainWindow?.webContents.send('wireguard-install-progress', { stage, percent });
			});
			return result;
		} catch (err) {
			return { success: false, message: err.message };
		}
	});
```

- [ ] **Step 5: Commit**

```bash
git add src/main/main.js
git commit -m "feat(main): switch to wireguard-native, remove install logic"
```

---

### Task 7: Update preload.js — remove install API

**Files:**
- Modify: `src/main/preload.js`

- [ ] **Step 1: Remove wireguard.install and onInstallProgress**

Replace the wireguard section (lines 37-45):

```js
// OLD:
	wireguard: {
		check:   () => ipcRenderer.invoke('wireguard:check'),
		install: () => ipcRenderer.invoke('wireguard:install'),
		onInstallProgress: (cb) => {
			const handler = (_, progress) => cb(progress);
			ipcRenderer.on('wireguard-install-progress', handler);
			return () => ipcRenderer.removeListener('wireguard-install-progress', handler);
		},
	},

// NEW:
	wireguard: {
		check: () => ipcRenderer.invoke('wireguard:check'),
	},
```

- [ ] **Step 2: Commit**

```bash
git add src/main/preload.js
git commit -m "refactor(preload): remove wireguard install API"
```

---

### Task 8: Update installer.nsh — remove WireGuard service cleanup

**Files:**
- Modify: `scripts/installer.nsh`

- [ ] **Step 1: Remove WireGuard tunnel service cleanup**

Replace the uninstall macro. Remove the WireGuard tunnel service block (lines 28-30):

```nsh
; REMOVE these lines:
	; WireGuard Tunnel-Service entfernen (falls vorhanden)
	IfFileExists "$PROGRAMFILES\WireGuard\wireguard.exe" 0 +2
		nsExec::ExecToLog '"$PROGRAMFILES\WireGuard\wireguard.exe" /uninstalltunnelservice gatecontrol0'
```

And update the comment at the top of the file:

```nsh
; OLD:
; WireGuard wird bei Bedarf automatisch von der App installiert
; NEW:
; WireGuard-nt ist in der App eingebettet, keine externe Installation noetig
```

- [ ] **Step 2: Commit**

```bash
git add scripts/installer.nsh
git commit -m "refactor(installer): remove WireGuard service cleanup"
```

---

### Task 9: Delete old files

**Files:**
- Delete: `src/services/wireguard.js`
- Delete: `src/services/wireguard-installer.js`

- [ ] **Step 1: Delete old wireguard service files**

```bash
git rm src/services/wireguard.js
git rm src/services/wireguard-installer.js
```

- [ ] **Step 2: Commit**

```bash
git commit -m "refactor: remove old WireGuard CLI wrapper and installer (replaced by wireguard-native)"
```

---

### Task 10: Final verification and integration test

- [ ] **Step 1: Verify all imports resolve**

Check that no file references the deleted modules:

```bash
grep -r "wireguard-installer" src/
grep -r "require.*services/wireguard'" src/
```

Both should return zero results. The only wireguard require should be `wireguard-native`.

- [ ] **Step 2: Verify package.json is consistent**

```bash
node -e "const p = require('./package.json'); console.log('deps:', Object.keys(p.dependencies).join(', '))"
```

Expected output: `deps: axios, electron-store, electron-log, jsqr, koffi, node-schedule, ws`

No `sudo-prompt` in the list.

- [ ] **Step 3: Verify the service interface matches connection-monitor expectations**

Confirm `connection-monitor.js` only calls `wgService.getStats()` — no other WireGuard methods:

```bash
grep "wgService\." src/services/connection-monitor.js
```

Expected: only `this.wgService.getStats()`.

- [ ] **Step 4: Commit final state**

```bash
git add -A
git status
git commit -m "chore: verify wireguard-nt integration, clean up"
```

Only commit if there are any remaining changes. If `git status` shows clean, skip this commit.
