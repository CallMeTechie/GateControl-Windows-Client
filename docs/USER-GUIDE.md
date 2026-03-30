# GateControl Windows Client — Benutzerhandbuch

Vollständige Anleitung für Installation, Einrichtung und Nutzung des GateControl Windows Clients.

---

## Inhaltsverzeichnis

1. [Systemanforderungen](#systemanforderungen)
2. [Installation](#installation)
3. [Ersteinrichtung](#ersteinrichtung)
4. [Verbindung herstellen](#verbindung-herstellen)
5. [Die Benutzeroberfläche](#die-benutzeroberfläche)
6. [Erreichbare Dienste](#erreichbare-dienste)
7. [DNS-Leak-Test](#dns-leak-test)
8. [Kill-Switch](#kill-switch)
9. [Tray-Icon](#tray-icon)
10. [Konfiguration importieren](#konfiguration-importieren)
11. [Einstellungen](#einstellungen)
12. [Auto-Update](#auto-update)
13. [Auto-Reconnect](#auto-reconnect)
14. [Server-Synchronisation](#server-synchronisation)
15. [Logs und Fehlerbehebung](#logs-und-fehlerbehebung)
16. [Deinstallation](#deinstallation)
17. [Datenspeicherung](#datenspeicherung)
18. [Häufige Probleme](#häufige-probleme)

---

## Systemanforderungen

| Anforderung | Details |
|-------------|---------|
| Betriebssystem | Windows 10 oder Windows 11 (64-Bit) |
| Berechtigungen | Administrator-Rechte erforderlich |
| Netzwerk | Internetzugang zum GateControl-Server |
| GateControl Server | Version 1.6.0 oder neuer |
| API-Token | Token mit Scope `Client App` |

> **Hinweis:** WireGuard muss nicht separat installiert werden. Die benötigten Komponenten (`wireguard.dll`, `wintun.dll`) sind in der App eingebettet.

---

## Installation

### Installer (.exe)

1. `GateControl Setup.exe` herunterladen
2. Rechtsklick auf die Datei, dann **Als Administrator ausführen**
3. Installationsassistent durchlaufen
4. Die App wird automatisch gestartet

Der Installer erstellt:
- Desktop-Verknüpfung
- Startmenü-Eintrag
- Windows-Firewall-Regel für die App

### Portable Version

Die portable Version kann ohne Installation gestartet werden. Rechtsklick auf `GateControl.exe`, dann **Als Administrator ausführen**.

---

## Ersteinrichtung

### Schritt 1: API-Token im GateControl Server erstellen

1. GateControl Web-UI öffnen
2. **Settings** aufrufen, dann **API & Webhooks**
3. Unter **API Tokens** einen Token-Namen eingeben (z.B. `Windows Client Marc`)
4. Bei **Integration** den Scope **Client App** aktivieren
5. **Create Token** klicken
6. Den angezeigten Token (`gc_...`) kopieren — er wird nur einmal angezeigt

### Schritt 2: Client konfigurieren

1. GateControl Client starten
2. Auf den Tab **Settings** wechseln
3. **Server URL** eingeben (z.B. `https://vpn.example.com`)
4. **API Key** einfügen (den kopierten `gc_...` Token)
5. **Test Connection** klicken — bei Erfolg erscheint eine Bestätigung
6. **Save & Register** klicken

Der Client registriert sich automatisch als neuer Peer auf dem Server. Die Peer-ID wird gespeichert und die WireGuard-Konfiguration vom Server heruntergeladen.

> **Tipp:** Im GateControl Web-UI erscheint der neue Peer unter **Peers** mit dem Hostnamen des Windows-PCs.

---

## Verbindung herstellen

### Manuell verbinden

1. Auf der **Status**-Seite den **Connect**-Button klicken
2. Der Verbindungsring wechselt auf Gelb (verbinde...) und dann auf Grün (verbunden)
3. Die Statistiken zeigen Endpoint, Handshake, RX/TX an

### Automatisch verbinden

Wenn **Auto-Connect** aktiviert ist (Standard), verbindet sich der Client automatisch beim Start der App. Dies funktioniert auch zusammen mit dem Windows-Autostart.

### Trennen

Den **Disconnect**-Button klicken oder im Tray-Menü **Trennen** wählen.

---

## Die Benutzeroberfläche

Die App hat drei Seiten, zwischen denen über die Navigation oben gewechselt wird.

### Titlebar

In der Titelleiste wird neben "GateControl" die aktuelle **Versionsnummer** angezeigt (z.B. `v1.3.0`).

### Status-Seite (Startseite)

| Element | Beschreibung |
|---------|-------------|
| **Verbindungsring** | Grün = verbunden, Gelb = verbinde, Grau = getrennt |
| **Connect/Disconnect** | Hauptschalter für den VPN-Tunnel |
| **Server** | URL des GateControl-Servers |
| **Handshake** | Zeitpunkt des letzten erfolgreichen Handshakes |
| **Download/Upload** | Übertragene Datenmenge seit Verbindungsaufbau |
| **Kill-Switch** | Schalter für den Netzwerk-Schutz |
| **Erreichbare Dienste** | Liste der konfigurierten Routen auf dem Server (erscheint nach Verbindung) |
| **DNS-Leak-Test** | Button zum Prüfen ob DNS-Anfragen durch den VPN-Tunnel gehen |

### Settings-Seite

Konfiguration von Server-Verbindung, App-Verhalten und Config-Import.

### Logs-Seite

Echtzeit-Anzeige der letzten 200 Log-Zeilen mit Aktualisieren-Button.

---

## Erreichbare Dienste

Nach dem Verbindungsaufbau zeigt die Status-Seite eine Liste aller auf dem GateControl-Server konfigurierten HTTP-Routen an.

| Information | Beschreibung |
|------------|-------------|
| **Name** | Name oder Domain der Route |
| **Domain** | Die vollständige Domain des Dienstes |
| **Auth-Badge** | Zeigt an ob die Route eine Authentifizierung erfordert |

Ein Klick auf einen Dienst öffnet ihn direkt im Standard-Browser.

> **Hinweis:** Es werden nur aktivierte HTTP-Routen angezeigt. Layer-4 (TCP/UDP) Routen erscheinen nicht in der Liste.

---

## DNS-Leak-Test

Der DNS-Leak-Test prüft, ob DNS-Anfragen tatsächlich durch den VPN-Tunnel geleitet werden oder am Tunnel vorbei ins offene Internet gehen.

### Test durchführen

1. VPN-Verbindung herstellen
2. Auf der Status-Seite **DNS-Leak-Test** klicken
3. Der Test läuft automatisch (wenige Sekunden)

### Ergebnisse

| Ergebnis | Bedeutung |
|----------|-----------|
| **Kein DNS-Leak erkannt** (grün) | DNS-Anfragen laufen über den VPN-Tunnel. Sicher. |
| **DNS-Leak möglich** (rot) | DNS-Anfragen gehen möglicherweise am VPN vorbei. Empfehlung: Kill-Switch aktivieren oder DNS-Einstellungen prüfen. |

Der Test zeigt zusätzlich die aktuell verwendeten DNS-Server an.

---

## Kill-Switch

Der Kill-Switch blockiert **allen Netzwerkverkehr**, der nicht durch den VPN-Tunnel läuft. Das verhindert Datenlecks bei Verbindungsabbrüchen.

### Aktivieren

- Auf der Status-Seite den **Kill-Switch Toggle** einschalten
- Oder im Tray-Menü den Punkt **Kill-Switch** wählen

### Was wird erlaubt

| Verkehr | Grund |
|---------|-------|
| Loopback (127.0.0.0/8) | Lokale Dienste (localhost) |
| LAN (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) | Lokales Netzwerk, Drucker, NAS |
| WireGuard-Endpoint (UDP) | Verbindung zum VPN-Server |
| VPN-Subnetz | Verkehr durch den Tunnel |
| DHCP (UDP 67/68) | IP-Adressvergabe |
| **Alles andere** | **Blockiert (Ein- und Ausgehend)** |

### Deaktivieren

Kill-Switch Toggle ausschalten — alle Firewall-Regeln werden sofort entfernt.

> **Wichtig:** Falls die App bei aktivem Kill-Switch abstürzt, bleiben die Firewall-Regeln bestehen und das Internet ist blockiert. Beim nächsten Start der App werden sie automatisch bereinigt. Für die manuelle Bereinigung siehe [Häufige Probleme](#häufige-probleme).

---

## Tray-Icon

Die App läuft im System-Tray (Taskleiste unten rechts). Das Fenster-Schließen (X-Button) minimiert die App ins Tray — die VPN-Verbindung bleibt bestehen.

### Status-Farben

| Farbe | Bedeutung |
|-------|-----------|
| Grün | Verbunden — Tunnel aktiv |
| Gelb | Verbinde — Tunnel wird aufgebaut oder Reconnect läuft |
| Grau | Getrennt — Kein aktiver Tunnel |

### Kontextmenü (Rechtsklick)

| Menüpunkt | Funktion |
|-----------|----------|
| **GateControl** | Fenster öffnen |
| **Status: Verbunden** | Zeigt aktuellen Status |
| **Endpoint: x.x.x.x** | Zeigt Server-Adresse (nur wenn verbunden) |
| **Verbinden / Trennen** | Tunnel ein-/ausschalten |
| **Kill-Switch** | Kill-Switch ein-/ausschalten |
| **Einstellungen** | Öffnet Settings-Seite |
| **Beenden** | App komplett schließen (Tunnel wird getrennt) |

### Fensterverhalten

- **X-Button** (Schließen) minimiert ins Tray (App läuft weiter)
- **Doppelklick** auf Tray-Icon öffnet das Fenster
- **Beenden** nur über Tray-Menü (trennt den Tunnel)

---

## Konfiguration importieren

Es gibt drei Wege, eine WireGuard-Konfiguration zu laden:

### 1. Vom Server (empfohlen)

Über die Server-Registrierung (siehe [Ersteinrichtung](#ersteinrichtung)) wird die Konfiguration automatisch heruntergeladen und aktuell gehalten.

### 2. Per Datei (.conf)

1. **Settings** öffnen
2. **Config importieren** Bereich finden
3. **Datei auswählen** klicken
4. Eine Standard-WireGuard `.conf`-Datei auswählen

### 3. Per QR-Code

1. **Settings** öffnen
2. **QR-Code scannen** klicken
3. Die Webcam wird aktiviert
4. WireGuard QR-Code vor die Kamera halten
5. Bei Erkennung wird die Konfiguration automatisch importiert

> **Hinweis:** Der QR-Code muss eine vollständige WireGuard-Konfiguration enthalten (wie sie z.B. im GateControl Web-UI bei einem Peer angezeigt wird).

---

## Einstellungen

### Server

| Einstellung | Beschreibung |
|-------------|-------------|
| **Server URL** | Vollständige URL des GateControl-Servers (z.B. `https://vpn.example.com`) |
| **API Key** | API-Token mit `client` Scope (`gc_...`) |
| **Test Connection** | Prüft ob der Server erreichbar ist und der Token gültig ist |
| **Save & Register** | Speichert die Einstellungen und registriert den Client als Peer |

### App-Verhalten

| Einstellung | Standard | Beschreibung |
|-------------|----------|-------------|
| **Mit Windows starten** | An | App startet automatisch bei der Windows-Anmeldung |
| **Minimiert starten** | An | Startet im Tray statt mit offenem Fenster |
| **Auto-Connect** | An | Stellt die VPN-Verbindung beim App-Start automatisch her |
| **Verbindungsprüfung** | 30 Sek. | Intervall für Handshake-Überprüfung (5 bis 300 Sekunden) |
| **Config-Polling** | 300 Sek. | Intervall für Server-Konfigurations-Updates (30 bis 3600 Sekunden) |

---

## Auto-Update

Die App prüft automatisch ob eine neue Version verfügbar ist und bietet die Installation an.

### Ablauf

1. **10 Sekunden nach App-Start** wird der GateControl-Server nach Updates gefragt
2. Danach wird **alle 6 Stunden** erneut geprüft
3. Wenn ein Update verfügbar ist, wird der Installer **im Hintergrund heruntergeladen**
4. Nach dem Download erscheint ein **Banner am unteren Rand**: "Update vX.Y.Z bereit zur Installation"
5. **"Jetzt neustarten"** klicken: Tunnel wird sicher getrennt, Kill-Switch deaktiviert, Installer gestartet
6. **"Später"** klicken: Banner verschwindet, Update wird beim nächsten Beenden erneut angeboten

### Tray-Menü

Wenn ein Update bereit ist, erscheint im Tray-Kontextmenü ein zusätzlicher Eintrag:

```
⬆ Update v1.4.0 installieren
```

### Voraussetzungen

- Der GateControl-Server muss erreichbar sein
- Der Server muss Zugriff auf die GitHub Releases des Client-Repos haben
- Bei privaten Repos muss `GC_CLIENT_GITHUB_TOKEN` auf dem Server gesetzt sein
- Bei öffentlichen Repos ist keine zusätzliche Konfiguration nötig

---

## Auto-Reconnect

Bei einem Verbindungsverlust versucht der Client automatisch, die Verbindung wiederherzustellen.

### Erkennung

Die Verbindung gilt als verloren, wenn:
- Der letzte Handshake **älter als 180 Sekunden** ist
- **3 aufeinanderfolgende** Verbindungsprüfungen fehlschlagen

### Wiederverbindungs-Strategie

Der Client nutzt Exponential Backoff (steigende Wartezeiten):

| Versuch | Wartezeit |
|---------|-----------|
| 1 | 2 Sekunden |
| 2 | 3 Sekunden |
| 3 | 4,5 Sekunden |
| 4 | 6,75 Sekunden |
| 5 | 10 Sekunden |
| 6 | 15 Sekunden |
| 7 | 22,5 Sekunden |
| 8 | 33,75 Sekunden |
| 9 | 50,6 Sekunden |
| 10 | 60 Sekunden (Maximum) |

Nach 10 fehlgeschlagenen Versuchen wird aufgegeben und eine Fehlerbenachrichtigung angezeigt.

### Benachrichtigungen

| Ereignis | Meldung |
|----------|---------|
| Verbindung hergestellt | *GateControl: Verbunden* |
| Verbindung getrennt (manuell) | *GateControl: Getrennt* |
| Reconnect erfolgreich | *GateControl: Wiederverbunden* |
| Reconnect fehlgeschlagen | *GateControl: Verbindung verloren* |
| Verbindungsfehler | *GateControl: Verbindungsfehler* |

---

## Server-Synchronisation

Der Client synchronisiert sich regelmäßig mit dem GateControl-Server.

### Config-Polling

Alle 5 Minuten (Standard) prüft der Client, ob sich die WireGuard-Konfiguration auf dem Server geändert hat:

1. Client sendet aktuellen Config-Hash an den Server
2. Server vergleicht mit aktuellem Hash
3. **Keine Änderung:** Keine Aktion
4. **Änderung erkannt:** Neue Config wird heruntergeladen, Tunnel wird kurz getrennt und mit neuer Config wiederverbunden

### Heartbeat

Periodisch sendet der Client seinen Status an den Server:
- Verbindungsstatus (verbunden/getrennt)
- Traffic-Statistiken (RX/TX Bytes)
- Laufzeit

Der Server aktualisiert damit den Zeitstempel unter **Zuletzt gesehen** des Peers.

---

## Logs und Fehlerbehebung

### Log-Dateien

Die Logs werden gespeichert unter:

```
%APPDATA%\GateControl\logs\main.log
```

Maximale Dateigröße: 5 MB (automatische Rotation).

### Log-Anzeige in der App

1. Tab **Logs** öffnen
2. Die letzten 200 Zeilen werden angezeigt
3. **Aktualisieren**-Button für aktuelle Einträge

### Was wird geloggt

- App-Start und -Beendigung
- Tunnel-Verbindung und -Trennung
- Kill-Switch Aktivierung/Deaktivierung
- Config-Polling Ergebnisse
- Reconnect-Versuche und Ergebnisse
- API-Fehler und Timeouts
- Firewall-Regeländerungen

---

## Deinstallation

### Über Windows

1. **Windows-Einstellungen** dann **Apps** dann **GateControl** dann **Deinstallieren**
2. Dem Deinstallationsassistenten folgen

### Was wird entfernt

- Programmdateien aus `C:\Program Files\GateControl\`
- Windows-Firewall-Regel für GateControl
- Alle Kill-Switch Firewall-Regeln
- Autostart-Registrierungseintrag

### Was bleibt erhalten

Die Benutzerkonfiguration bleibt bewusst erhalten, damit bei einer Neuinstallation nicht alles neu eingerichtet werden muss:

```
%APPDATA%\gatecontrol-client\
  gatecontrol-config.json     (Server-URL, API-Key, Einstellungen)
  wireguard\
    gatecontrol0.conf         (WireGuard-Konfiguration)
```

Um auch die Konfiguration zu löschen, den Ordner `%APPDATA%\gatecontrol-client\` manuell entfernen.

---

## Datenspeicherung

### Übersicht

| Daten | Speicherort | Verschlüsselt |
|-------|-------------|---------------|
| App-Konfiguration | `%APPDATA%\gatecontrol-client\gatecontrol-config.json` | Ja |
| WireGuard-Config | `%APPDATA%\gatecontrol-client\wireguard\gatecontrol0.conf` | Nein |
| Log-Dateien | `%APPDATA%\GateControl\logs\main.log` | Nein |
| Autostart | Registry: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` | — |

### Gespeicherte Einstellungen

| Schlüssel | Inhalt |
|-----------|--------|
| `server.url` | Server-URL |
| `server.apiKey` | API-Token |
| `server.peerId` | Zugewiesene Peer-ID |
| `tunnel.interfaceName` | WireGuard-Adaptername (`gatecontrol0`) |
| `tunnel.autoConnect` | Auto-Connect an/aus |
| `tunnel.killSwitch` | Kill-Switch an/aus |
| `tunnel.configPath` | Pfad zur .conf-Datei |
| `app.startMinimized` | Minimiert starten |
| `app.startWithWindows` | Windows-Autostart |
| `app.checkInterval` | Verbindungsprüfungs-Intervall (ms) |
| `app.configPollInterval` | Config-Polling-Intervall (ms) |

---

## Häufige Probleme

### "WireGuard-Konfiguration konnte nicht gesetzt werden"

**Ursache:** Die App läuft nicht als Administrator.

**Lösung:** App beenden. Rechtsklick auf GateControl, dann **Als Administrator ausführen**.

---

### "WireGuard-Adapter konnte nicht erstellt werden"

**Ursache:** Fehlende Administrator-Rechte oder ein Konflikt mit einer anderen WireGuard-Instanz.

**Lösung:**
1. Andere WireGuard-Clients beenden
2. App als Administrator starten
3. Gegebenenfalls PC neustarten

---

### Kill-Switch blockiert Internet nach App-Crash

**Ursache:** Die Firewall-Regeln wurden bei einem Absturz nicht bereinigt.

**Lösung:** Admin-Eingabeaufforderung (cmd) öffnen und folgende Befehle ausführen:

```cmd
netsh advfirewall firewall delete rule name="GateControl_KS_Block_All_Out"
netsh advfirewall firewall delete rule name="GateControl_KS_Block_All_In"
netsh advfirewall firewall delete rule name="GateControl_KS_Allow_Loopback"
netsh advfirewall firewall delete rule name="GateControl_KS_Allow_WG_Endpoint"
netsh advfirewall firewall delete rule name="GateControl_KS_Allow_VPN_Subnet"
netsh advfirewall firewall delete rule name="GateControl_KS_Allow_DHCP"
netsh advfirewall firewall delete rule name="GateControl_KS_Allow_LAN_10_0_0_0_8"
netsh advfirewall firewall delete rule name="GateControl_KS_Allow_LAN_172_16_0_0_12"
netsh advfirewall firewall delete rule name="GateControl_KS_Allow_LAN_192_168_0_0_16"
```

Alternativ die App einfach neu starten — sie bereinigt verwaiste Regeln automatisch.

---

### Server-Verbindung schlägt fehl

**Mögliche Ursachen und Lösungen:**

| Problem | Lösung |
|---------|--------|
| Falsche URL | Muss mit `https://` oder `http://` beginnen |
| Falscher API-Key | Token muss mit `gc_` beginnen und den Scope `Client App` haben |
| Server nicht erreichbar | Firewall, DNS oder Netzwerkproblem prüfen |
| Token abgelaufen | Im GateControl Web-UI unter Settings neuen Token erstellen |

---

### QR-Code wird nicht erkannt

- Kamera-Berechtigung in Windows prüfen (**Einstellungen, Datenschutz, Kamera**)
- QR-Code gut beleuchtet und scharf vor die Kamera halten
- Mindestabstand ca. 15 cm einhalten

---

## Tastenkürzel

| Kürzel | Funktion |
|--------|----------|
| `Strg+Q` | App beenden |
| `Escape` | Fenster ins Tray minimieren |

---

## Technische Details

### WireGuard-Integration

Der Client nutzt WireGuard-NT direkt über FFI (Foreign Function Interface). Es werden keine externen Prozesse gestartet. Die eingebetteten Bibliotheken:

- `wireguard.dll` — WireGuard-NT Kernel-Implementierung
- `wintun.dll` — TUN-Netzwerkadapter-Treiber

### Netzwerk-Adapter

Bei aktiver Verbindung erscheint ein Netzwerkadapter namens `gatecontrol0` in den Windows-Netzwerkeinstellungen. Dieser wird beim Trennen automatisch entfernt.

### Ports und Protokolle

| Protokoll | Port | Richtung | Zweck |
|-----------|------|----------|-------|
| UDP | 51820 (Standard) | Ausgehend | WireGuard-Tunnel zum Server |
| HTTPS | 443 | Ausgehend | API-Kommunikation mit GateControl-Server |
