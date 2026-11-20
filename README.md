# LSS Leitstellen-Maßnahmen

Mehr zu tun als Disponent: Dieses Script gibt deinen Einsätzen im Leitstellenspiel **realistische Zusatzaufgaben**, die du selbst per Anruf oder Funk abarbeitest – dazu eine **Personal- und Gebäudesuche**, einen **Personalrechner** und eine **Werbephasen-Warnung**.

Das Script **alarmiert nichts, kauft nichts und klickt nichts für dich**. Es zeigt nur an und liest deine eigenen Spieldaten.

## Funktionen

### 📋 Weitere Maßnahmen im Einsatzfenster
- Über 30 Regeln für typische Einsätze: Gas (Stadtwerke), Kanal (Stadtentwässerung), Ölspur/Betriebsstoffe (Straßenmeisterei, Kläranlage), Bahn (Strecke sperren, Bahnerdung), Strom (Freischaltung), Gefahrgut (Umweltamt, NINA-Warnung, TUIS), Wald (Förster), Wohnungsbrand (Unterbringung), MANV (LNA/OrgL, Krankenhäuser) u. v. m.
- 📞 Anrufen / 📻 Funken – manchmal ist besetzt
- Rückmeldungen nach einigen Minuten („Abschleppdienst vor Ort“), die du quittieren musst
- Nur für **eigene** Einsätze, Verbandseinsätze werden ignoriert

### 🚦 Farbige Abzeichen in der Einsatzliste
- 🔴 noch nichts gemacht · 🟡 angefangen · 🔵 Rückmeldung wartet · 🟢 alles erledigt
- Zähler unten links: offen / erledigt / vergessen

### 👥 Personal & Wachen (Button neben „Ort suchen…“)
- **Personal:** alle Leute aus allen Wachen durchsuchen – Name, Ausbildung, Wache, Fahrzeug; Filter nach Ausbildung
- **Gebäude:** alle Gebäude mit Personal, Personalziel, Fahrzeugbedarf (mind./voll) und Werbephase; ➤ zentriert die Karte auf das Gebäude
- **🧮 Rechner:** Fahrzeuge suchen und zusammenstellen → benötigtes Personal, Lehrgänge mit Dauer, Zeit bis zur vollen Besetzung einer neuen Wache und welche deiner Wachen das sofort stemmen können

### ⚠️ Werbephasen-Warnung
- Meldung, wenn eine Wache unter ihrem Personalziel ist und keine Werbephase läuft
- Die Werbung startest du selbst (kostet Credits)

## Installation
1. Browser-Erweiterung **Tampermonkey** oder **Violentmonkey** installieren.
2. Script installieren: über [Greasy Fork](https://greasyfork.org/de/scripts/606349) oder hier im Repository die Datei `lss-massnahmen.user.js` öffnen → **Raw** → Tampermonkey fragt nach → **Installieren**.
3. Leitstellenspiel neu laden (F5).

## Funktionen an/aus
Ganz oben im Script unter `FUNKTIONEN` kannst du jede Funktion mit `'ja'` oder `'nein'` ein- oder ausschalten: `massnahmen`, `abzeichen`, `meldungen`, `statistik`, `personalPanel`, `rechner`, `werbeWarnung`. Danach speichern und das Spiel neu laden.

## Einstellungen
Ganz oben im Script unter `CFG`:
- `zoom` – Größe aller Elemente (z. B. 1.3)
- `besetztChance` – wie oft beim Anruf besetzt ist
- `rueckmeldungMin` / `rueckmeldungMax` – Rückmeldezeit in Sekunden
- `werbeWarnAlleMin` – wie oft die Werbephasen-Warnung wiederholt wird

## Datenschutz & Datenquellen
- Eigene Spieldaten von leitstellenspiel.de (Gebäude, Fahrzeuge, Personalseiten deiner Wachen). Gebäude und Fahrzeuge werden nach dem Forumsstandard im sessionStorage (`aBuildings`, `aVehicles`) zwischengespeichert und höchstens alle 5 Minuten neu abgefragt. Das Personal wird mit kurzen Pausen zwischen den Wachen geladen und 30 Minuten zwischengespeichert.
- Fahrzeug- und Lehrgangsdaten (Besatzung, nötige Ausbildungen, Lehrgangsdauer) von der Schnittstelle des LSS-Managers (api.lss-manager.de). Danke an das LSSM-Team!
- Es werden **keine Daten an Dritte gesendet**. Der Fortschritt wird nur lokal im Browser gespeichert.

## Entstehung
Das Script ist mit KI-Unterstützung (Claude von Anthropic) entstanden. Idee, Funktionen und Tests im Spiel: Rox88.

## Hinweise
- Die Maßnahmen sind Rollenspiel – im Spiel selbst ändern sie nichts.
- Die Einstelldauer im Rechner ist die schnellstmögliche (laut Spiel max. 1 Person pro Nacht bei aktiver Werbephase).
- Feedback, Fehler und Ideen für neue Maßnahmen gerne als **Issue** hier auf GitHub!

Copyright (c) 2026 Rox88 (LSS und greasyfork) aka Rox-LSS (Github) · Lizenz: MIT
