# Changelog

## [1.3.0] — 2026-03-30

### Features
- accessible services list and DNS leak test

---

## [1.2.4] — 2026-03-30

### Dokumentation
- CHANGELOG mit allen fehlenden Features nachgetragen

---

## [1.2.3] — 2026-03-30

### Fixes
- move version bumping to CI/CD workflow (local hooks unreliable)

---

## [1.2.2] — 2026-03-30

### Features
- **Auto-Update** — App prüft beim Start und alle 6 Stunden über den GateControl-Server auf neue Versionen. Stilles Download im Hintergrund, Banner-Dialog wenn Update bereit ("Jetzt neustarten" / "Später"). Server-seitiger Update-Endpoint mit GitHub Release Proxy für private Repos.

### Fixes
- CI/CD Node.js 22, fetch-tags Korrektur

---

## [1.2.1] — 2026-03-29

### Features
- **CI/CD Pipeline** — Automatischer Build & Release bei jedem Push auf master. NSIS Installer + Portable als GitHub Release Assets.
- **Automatische Versionierung** — Version-Bump im CI: `feat:` → Minor, alles andere → Patch. CHANGELOG wird automatisch aktualisiert.

### Fixes
- Build-Größe reduziert (node_modules nicht mehr im files-Array, ungenutzte Dependencies ws/node-schedule entfernt)

---

## [1.1.0] — 2026-03-29

### Fixes
- **WireGuard-NT Struct-Alignment** — Alle drei Struct-Größen korrigiert (ALIGNED(8) statt packed): WIREGUARD_INTERFACE 74→80, WIREGUARD_PEER 130→136, WIREGUARD_ALLOWED_IP 20→24 Bytes. Behebt "Konfiguration konnte nicht gesetzt werden" Fehler.
- **Endpoint Routing-Loop** — Host-Route zum WireGuard-Server über physisches Gateway verhindert Routing-Loop bei AllowedIPs=0.0.0.0/0
- **DNS-Auflösung für Endpoints** — Hostnames im Endpoint werden per dns.lookup aufgelöst
- **Server-URL statt IP** — Status-Seite und Tray zeigen die Server-URL statt der rohen WireGuard-IP
- **IPv6 AllowedIPs** — Korrekte Kodierung von IPv6-Adressen (z.B. ::/0)

---

## [1.0.0] — 2026-03-29

### Initial Release
- Electron-basierter WireGuard VPN-Client mit nativer FFI-Integration (wireguard.dll/wintun.dll via Koffi)
- Auto-Connect beim Windows-Start
- Kill-Switch (Windows Firewall Whitelist-Regeln)
- Tray-Icon mit Statusfarben (grün/gelb/grau) und Kontextmenü
- Server-Registrierung und automatisches Config-Polling
- QR-Code und Datei-Import für WireGuard-Konfigurationen
- Auto-Reconnect mit Exponential Backoff (max 10 Versuche)
- Verschlüsselte Konfigurationsspeicherung (electron-store)
- Connection Monitor mit Handshake-Überwachung

---
