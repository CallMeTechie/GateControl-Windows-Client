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

  // ── Config Parsing ──────────────────────────────────────────

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

      if (peer.Endpoint) {
        flags |= WIREGUARD_PEER_HAS_ENDPOINT;
      }

      if (peer.PresharedKey) {
        flags |= WIREGUARD_PEER_HAS_PRESHARED_KEY;
      }

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

  // ── File I/O ────────────────────────────────────────────────

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

  // ── Tunnel Lifecycle ────────────────────────────────────────

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
      // Endpoint-Route über physisches Gateway setzen, damit VPN-Pakete
      // selbst nicht durch den Tunnel geroutet werden (Routing-Loop)
      if (peer.Endpoint) {
        const epMatch = peer.Endpoint.match(/^(.+):(\d+)$/);
        if (epMatch) {
          const endpointIP = epMatch[1];
          try {
            // Standard-Gateway des aktiven physischen Interfaces ermitteln
            const { stdout } = await execAsync(
              'powershell -Command "(Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Sort-Object RouteMetric | Select-Object -First 1).NextHop"'
            );
            const gateway = stdout.trim();
            if (gateway && gateway !== '0.0.0.0') {
              // Physisches Interface für dieses Gateway finden
              const { stdout: ifOut } = await execAsync(
                `powershell -Command "(Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Sort-Object RouteMetric | Select-Object -First 1).InterfaceIndex"`
              );
              const ifIndex = ifOut.trim();
              this._endpointRoute = { endpointIP, gateway, ifIndex };
              await execAsync(
                `netsh interface ip add route ${endpointIP}/32 interface=${ifIndex} nexthop=${gateway} metric=1`
              );
              this.log.info(`Endpoint-Route: ${endpointIP} via ${gateway} (if=${ifIndex})`);
            }
          } catch (err) {
            this.log.warn(`Endpoint-Route fehlgeschlagen: ${err.message}`);
          }
        }
      }

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

    // Endpoint-Route aufräumen
    if (this._endpointRoute) {
      try {
        const { endpointIP, ifIndex } = this._endpointRoute;
        await execAsync(
          `netsh interface ip delete route ${endpointIP}/32 interface=${ifIndex}`
        );
        this.log.info(`Endpoint-Route entfernt: ${endpointIP}`);
      } catch { /* Route ggf. schon weg */ }
      this._endpointRoute = null;
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

  // ── Statistics ──────────────────────────────────────────────

  /**
   * Tunnel-Statistiken abfragen
   * Gibt das gleiche Format wie der alte WireGuardService zurück
   */
  async getStats() {
    if (!this.adapter) return null;

    try {
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
}

module.exports = WireGuardNative;
