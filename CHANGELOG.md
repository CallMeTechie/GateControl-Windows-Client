# Changelog

## [1.7.3] — 2026-03-30

### Fixes
- bandwidth chart labels readable in light theme

---

## [1.7.2] — 2026-03-30

### Fixes
- window width 590px, add spacing between traffic usage and kill-switch

---

## [1.7.1] — 2026-03-30

### Fixes
- service item hover uses theme variable instead of hardcoded dark color

---

## [1.7.0] — 2026-03-30

### Features
- dark/light theme toggle with persistent setting

---

## [1.6.1] — 2026-03-30

### Dokumentation
- complete documentation update (README, CHANGELOG, USER-GUIDE)

---

## [1.6.0] — 2026-03-30

### Features
- **Traffic-Verbrauch** — Eigener Datenverbrauch (24h, 7 Tage, 30 Tage, Gesamt) auf der Status-Seite. Daten werden vom GateControl-Server über neuen Endpoint `/api/v1/client/traffic` abgerufen.

---

## [1.5.0] — 2026-03-30

### Features
- **Split-Tunneling** — Nur bestimmte IPs/Subnetze durch den VPN-Tunnel leiten. Toggle + Textarea in den Settings, Speichern-Button mit automatischem Reconnect. VPN-Subnetz und Server-Endpoint werden immer automatisch geroutet.
- **Peer-Ablauf-Warnung** — Windows-Benachrichtigung und farbiger Banner auf der Status-Seite 7/3/1 Tage vor Ablauf des VPN-Zugangs. Prüfung über neuen Server-Endpoint `/api/v1/client/peer-info`.
- **App-Logo in Benachrichtigungen** — Windows-Notifications zeigen jetzt das GateControl-Icon.

### Fixes
- Keine doppelten Peers mehr bei wiederholtem "Speichern & Registrieren" (Server prüft peerId + Hostname)
- DNS-Leak-Test empfiehlt Kill-Switch statt aggressiver DNS-Umleitung
- Tray-Tooltip aktualisiert sich jetzt live (war beim Connect-Zeitpunkt eingefroren)
- Auto-Update mit erweitertem Logging für Fehlerdiagnose

---

## [1.4.0] — 2026-03-30

### Features
- **Bandbreiten-Graph** — Live-Canvas-Graph (60 Datenpunkte, ~5 Min. Historie) auf der Status-Seite. Grüne Linie = Download, blaue Linie = Upload, auto-skalierende Y-Achse.
- **Speed-Anzeige** — Aktuelle Download-/Upload-Geschwindigkeit (KB/s, MB/s) unter den RX/TX Statistiken.
- **Tray-Tooltip mit Stats** — Hover über Tray-Icon zeigt: Server-URL, Verbindungsdauer, RX/TX Traffic.

### Fixes
- Feste Fensterbreite (480px, nicht mehr verbreiterbar)
- Korrekter App-Name "GateControl Client" in Windows-Benachrichtigungen (war `electron.app.gatecontrol`)
- DNS-Cache wird beim Connect und Disconnect geleert

---

## [1.3.0] — 2026-03-30

### Features
- **Auto-Update** — Prüft beim Start und alle 6 Stunden über den GateControl-Server auf neue Versionen. Stilles Download im Hintergrund, Banner-Dialog wenn Update bereit ("Jetzt neustarten" / "Später"). Tray-Menü-Eintrag bei verfügbarem Update.
- **Erreichbare Dienste** — Liste aller aktiven HTTP-Routen vom Server auf der Status-Seite. Klick öffnet den Dienst im Browser. Auth-Badge bei geschützten Routen.
- **DNS-Leak-Test** — Button auf der Status-Seite prüft ob DNS-Anfragen durch den VPN-Tunnel gehen. Grün = sicher, Rot = Kill-Switch empfohlen.
- **Versionsanzeige** — Aktuelle Version im Titlebar (`GateControl v1.3.0`).

### Fixes
- X-Client-Version Header dynamisch aus package.json (war hardcoded `1.0.0`)

---

## [1.2.0] — 2026-03-29

### Features
- **CI/CD Pipeline** — Automatischer Build & Release bei jedem Push auf master. NSIS Installer + Portable als GitHub Release Assets.
- **Automatische Versionierung** — Version-Bump im CI: `feat:` → Minor, alles andere → Patch. CHANGELOG wird automatisch aktualisiert.

### Fixes
- Build-Größe reduziert (ungenutzte Dependencies entfernt)

---

## [1.1.0] — 2026-03-29

### Fixes
- **WireGuard-NT Struct-Alignment** — Struct-Größen korrigiert (ALIGNED(8)): Interface 74→80, Peer 130→136, AllowedIP 20→24 Bytes. Behebt "Konfiguration konnte nicht gesetzt werden".
- **Endpoint Routing-Loop** — Host-Route zum WireGuard-Server verhindert Routing-Loop bei AllowedIPs=0.0.0.0/0
- **DNS-Auflösung** — Hostnames im Endpoint werden aufgelöst
- **Server-URL statt IP** — Status-Seite und Tray zeigen die Server-URL
- **IPv6 AllowedIPs** — Korrekte Kodierung (z.B. ::/0)

---

## [1.0.0] — 2026-03-29

### Initial Release
- Electron-basierter WireGuard VPN-Client mit nativer FFI-Integration
- Auto-Connect beim Windows-Start
- Kill-Switch (Windows Firewall Whitelist-Regeln)
- Tray-Icon mit Statusfarben und Kontextmenü
- Server-Registrierung und Config-Polling
- QR-Code und Datei-Import
- Auto-Reconnect mit Exponential Backoff
- Verschlüsselte Konfigurationsspeicherung
- Connection Monitor mit Handshake-Überwachung

---
