# Changelog

## [1.7.9] — 2026-03-30

### Fixes
- remove duplicate Split-Tunneling heading, rounded window corners, proper toggle-row borders

---

## [1.7.8] — 2026-03-30

### Fixes
- allow vertical resizing, width stays fixed at 590px

---

## [1.7.7] — 2026-03-30

### Dokumentation
- consolidate CHANGELOG with v1.8.0 theme release

---

## [1.8.0] — 2026-03-30

### Features
- **Dark/Light Theme** — Theme-Switch in den Settings mit Mond/Sonnen-Icons. Einstellung wird persistent gespeichert. Alle UI-Elemente inkl. Bandbreiten-Graph passen sich dem Theme an.

### Fixes
- DPI-bewusste Fenstergröße: 590px physische Breite auf jeder Skalierung (100%–200%)
- Fenster nicht mehr manuell verbreiterbar
- Hover-Effekt auf Dienste-Liste im Light Theme korrigiert
- Bandbreiten-Graph Labels im Light Theme lesbar
- Abstand zwischen Datenverbrauch und Kill-Switch

---

## [1.6.0] — 2026-03-30

### Features
- **Traffic-Verbrauch** — Eigener Datenverbrauch (24h, 7 Tage, 30 Tage, Gesamt) auf der Status-Seite. Daten werden vom GateControl-Server abgerufen.

---

## [1.5.0] — 2026-03-30

### Features
- **Split-Tunneling** — Nur bestimmte IPs/Subnetze durch den VPN-Tunnel leiten. Toggle + Textarea in den Settings, Speichern-Button mit automatischem Reconnect.
- **Peer-Ablauf-Warnung** — Windows-Benachrichtigung und farbiger Banner 7/3/1 Tage vor Ablauf des VPN-Zugangs.
- **App-Logo in Benachrichtigungen** — Windows-Notifications zeigen das GateControl-Icon.

### Fixes
- Keine doppelten Peers mehr bei wiederholtem "Speichern & Registrieren"
- DNS-Leak-Test empfiehlt Kill-Switch statt aggressiver DNS-Umleitung
- Tray-Tooltip aktualisiert sich live (war eingefroren)
- Auto-Update mit erweitertem Logging

---

## [1.4.0] — 2026-03-30

### Features
- **Bandbreiten-Graph** — Live-Canvas-Graph (~5 Min. Historie). Grün = Download, Blau = Upload.
- **Speed-Anzeige** — Aktuelle Geschwindigkeit unter den RX/TX Statistiken.
- **Tray-Tooltip mit Stats** — Server-URL, Verbindungsdauer, RX/TX Traffic.

### Fixes
- Korrekter App-Name "GateControl Client" in Windows-Benachrichtigungen
- DNS-Cache wird beim Connect/Disconnect geleert

---

## [1.3.0] — 2026-03-30

### Features
- **Auto-Update** — Prüft über den GateControl-Server auf neue Versionen. Stilles Download, Banner-Dialog, Tray-Menü-Eintrag.
- **Erreichbare Dienste** — Klickbare Liste der HTTP-Routen vom Server.
- **DNS-Leak-Test** — Prüft ob DNS durch den VPN-Tunnel geht.
- **Versionsanzeige** — Aktuelle Version im Titlebar.

---

## [1.2.0] — 2026-03-29

### Features
- **CI/CD Pipeline** — Automatischer Build & Release bei jedem Push auf master.
- **Automatische Versionierung** — `feat:` → Minor, alles andere → Patch.

---

## [1.1.0] — 2026-03-29

### Fixes
- WireGuard-NT Struct-Alignment korrigiert (ALIGNED(8))
- Endpoint Routing-Loop behoben
- DNS-Auflösung für Hostnames im Endpoint
- Server-URL statt IP in der Anzeige

---

## [1.0.0] — 2026-03-29

### Initial Release
- Native WireGuard-Integration (FFI)
- Auto-Connect, Kill-Switch, Tray-Icon
- Server-Registrierung und Config-Polling
- QR-Code und Datei-Import
- Auto-Reconnect mit Exponential Backoff

---
