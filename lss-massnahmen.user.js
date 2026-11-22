// ==UserScript==
// @name         LSS Leitstellen-Maßnahmen
// @namespace    rox88.lss.massnahmen
// @version      1.5.0-beta.3
// @description  Realistische Zusatzaufgaben für Einsätze (Stadtwerke, Bauhof, Bahn, Behörden …) zum Abarbeiten per Anruf/Funk, dazu Personal- und Gebäudesuche, Personal- und Kostenrechner und Werbephasen-Warnung. Alarmiert nichts und klickt nichts an.
// @author       Rox88(LSS und greasyfork) aka Rox-LSS (Github)
// @license      MIT
// @match        https://www.leitstellenspiel.de/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * LSS Leitstellen-Maßnahmen – Copyright (c) 2026 Rox88(LSS und greasyfork) aka Rox-LSS (Github) – MIT-Lizenz
 *
 * Das Script ist mit KI-Unterstützung (Claude von Anthropic) entstanden. Idee, Funktionen und Tests im Spiel: Rox88.
 *
 * Datenquellen:
 *  - eigene Spieldaten über leitstellenspiel.de (/api/buildings, /api/vehicles, Personalseiten der Wachen)
 *  - aktuelle Preise inkl. Rabattaktionen direkt vom Spiel (Bauformular /buildings/new, Kaufseiten /buildings/…/vehicles/new)
 *  - Fahrzeug-, Gebäude- und Lehrgangsdaten von der LSS-Manager-Schnittstelle (api.lss-manager.de)
 * Es werden keine Daten an Dritte gesendet. Spielstände werden nur lokal im Browser gespeichert (localStorage, Präfix „lssmz_“).
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

(function () {
  'use strict';

  /* ==================================================================
   * FUNKTIONEN AN / AUS   →   'ja' = an,  'nein' = aus
   * Danach speichern (Strg+S) und das Spiel neu laden (F5).
   * ================================================================== */
  const FUNKTIONEN = {
    massnahmen:    'ja',   // Zusatzaufgaben im Einsatzfenster (Anrufen/Funken, Rückmeldungen)
    abzeichen:     'ja',   // farbige Abzeichen 📋 in der Einsatzliste
    meldungen:     'ja',   // Meldungen unten rechts (Rückmeldungen, vergessene Maßnahmen)
    statistik:     'ja',   // Zähler unten links (offen / erledigt / vergessen)
    personalPanel: 'ja',   // Button „👥 Personal & Wachen“ neben „Ort suchen…“
    rechner:       'ja',   // Reiter „🧮 Rechner“ im Panel
    kostenrechner: 'ja',   // Reiter „💰 Kosten“ im Panel: Kostenrechner für Wache + Fahrzeuge (mit Rabattaktionen)
    werbeWarnung:  'ja',   // Warnung, wenn eine Wache unter Personalziel ist und keine Werbephase läuft
    aaoProtokoll:  'ja',   // merkt sich alte AAO-Werte beim Speichern, damit du sie wieder eintragen kannst
    verletzte:     'ja',   // Einsatzliste: 🩹 garantiert / ❔ möglicherweise / ⚪ keine Verletzten + Filter
    aaoFehlt:      'ja',   // AAO-Buttons mit 🚫, wenn du das Fahrzeug gar nicht besitzt
  };
  const AN = k => /^(yes|ja|j|y|true|an|on|1)$/i.test(String(FUNKTIONEN[k]).trim());

  /* ------------------------------------------------------------------
   * EINSTELLUNGEN
   * ------------------------------------------------------------------ */
  const CFG = {
    besetztChance: 0.12,      // Chance, dass beim Anruf besetzt ist
    zoom: 1.3,                // Größe aller Mod-Elemente (1 = normal, 1.3 = 130 %)
    rueckmeldungMin: 120,     // Rückmeldung frühestens nach … Sekunden
    rueckmeldungMax: 300,     // … und spätestens nach … Sekunden
    personalCacheMin: 30,     // Personal-Liste so viele Minuten zwischenspeichern
    preisCacheMin: 30,        // Kostenrechner: Preise vom Server so viele Minuten zwischenspeichern (Rabattaktionen!)
    werbeWarnAlleMin: 60,     // so oft (Minuten) die Warnung erneut als Meldung zeigen
    aaoAnzeige: 5,            // AAO-Protokoll: so viele frühere Stände bzw. geänderte AAOs anzeigen
    scanIntervall: 5000,      // ms – wie oft die Einsatzliste geprüft wird
    abschlussNachScans: 3,    // so oft muss ein Einsatz fehlen, bis er als beendet gilt
  };

  // Werte aus dem ⚙️-Einstellungsfenster (im Browser gespeichert) haben Vorrang vor den Werten oben.
  // So bleiben deine Einstellungen auch nach einem Update erhalten.
  const STANDARD = { funktionen: { ...FUNKTIONEN }, cfg: { ...CFG } };
  try {
    const e = JSON.parse(localStorage.getItem('lssmz_einst') || '{}');
    Object.assign(FUNKTIONEN, e.funktionen || {});
    Object.assign(CFG, e.cfg || {});
  } catch (e) {}

  /* ------------------------------------------------------------------
   * REGELN
   * re   = Regex auf den Einsatznamen
   * not  = Regex, die die Regel wieder ausschließt
   * tasks: k = Schlüssel, t = Aufgabe, w = Gesprächspartner,
   *        m = 'call' (Telefon) | 'funk' (Funk an EL), p = Chance (0–1),
   *        a = mögliche Antworten, f = Rückmeldung [Text, minSek, maxSek]
   * ------------------------------------------------------------------ */
  const RULES = [
    { re: /betriebsstoff|auslaufend/i, tasks: [
      { k: 'kanal_bs', t: 'Kanalbetrieb informieren (Betriebsstoffe im Gully?)', w: 'Stadtentwässerung Bereitschaft', m: 'call',
        a: [
          'Kanalarbeiter sind unterwegs und prüfen die Schächte, ca. 20 Minuten.',
          'Wir schicken einen Trupp mit Saugwagen, ca. 25 Minuten.',
          'Verstanden, wir sperren den Abfluss zur Kläranlage und kommen raus, ca. 15 Minuten.',
          'Bereitschaft ist alarmiert. Bitte die Gullys bis zu unserem Eintreffen abdecken, ca. 30 Minuten.',
          'Danke für die Meldung! Wir prüfen die Regenwasserleitung und sind in ca. 20 Minuten vor Ort.',
        ],
        f: ['Kanalarbeiter vor Ort – Schächte werden kontrolliert und abgesaugt.', 300, 600] },
      { k: 'klaeranlage', t: 'Kläranlage vorwarnen (Betriebsstoffe im Zulauf möglich)', w: 'Kläranlage Schichtleitung', m: 'call',
        a: [
          'Danke, wir beobachten den Zulauf und fahren das Rückhaltebecken an.',
          'Verstanden, wir kontrollieren den Ölabscheider.',
          'Alles klar, wir nehmen am Zulauf Proben und melden uns, falls etwas auffällt.',
          'Danke für die Vorwarnung, wir schließen vorsorglich den Schieber zum Vorfluter.',
          'Verstanden, die Schichtleitung ist informiert und überwacht die Messwerte.',
        ] },
      { k: 'strassenmeisterei_bs', t: 'Straßenmeisterei / Bauhof zur Fahrbahnreinigung anfordern', w: 'Straßenmeisterei', m: 'call',
        a: [
          'Fachfirma mit Nassreinigung ist beauftragt, ca. 30 Minuten.',
          'Wir kommen mit Bindemittel und Kehrmaschine, ca. 25 Minuten.',
          'Verstanden, Kolonne ist unterwegs, ca. 20 Minuten.',
          'Reinigungsfahrzeug ist angefordert, bitte Stelle bis dahin absichern, ca. 35 Minuten.',
          'Alles klar, wir übernehmen Reinigung und Beschilderung, ca. 25 Minuten.',
        ],
        f: ['Fachfirma Fahrbahnreinigung eingetroffen.', 300, 600] },
    ]},
    { re: /gas(austritt|geruch|leitung|ausstr|explosion|flasche)|erdgas|propan/i, tasks: [
      { k: 'gasversorger', t: 'Gasversorger / Stadtwerke (Entstörungsdienst) informieren', w: 'Stadtwerke Entstörung', m: 'call',
        a: [
          'Netzmonteur ist alarmiert, ca. 20 Minuten.',
          'Wir schicken einen Monteur mit Gasspürgerät, ca. 15 Minuten.',
          'Verstanden, Entstörungsdienst ist unterwegs. Bitte keine Zündquellen, ca. 20 Minuten.',
          'Monteur kommt und schiebert die Leitung ab, ca. 25 Minuten.',
          'Danke, wir prüfen den Netzbereich und sind in ca. 15 Minuten da.',
        ],
        f: ['Netzmonteur vor Ort – Leitung wird abgeschiebert. Freigabe erst nach Messung.', 240, 600] },
      { k: 'anwohner', t: 'Anwohner warnen lassen (Fenster/Türen schließen, keine Zündquellen)', w: 'Einsatzleiter', m: 'funk', p: 0.7,
        a: [
          'Verstanden, Lautsprecherdurchsage über FuStW läuft.',
          'Verstanden, Trupp klingelt die Nachbarhäuser ab.',
          'Verstanden, Anwohner werden gewarnt, Bereich ist abgesperrt.',
          'Verstanden, Durchsage läuft, Polizei sichert die Zufahrten.',
          'Verstanden, Nachbarn sind informiert, Fenster und Türen bleiben zu.',
        ] },
    ]},
    { re: /kanal|abwasser|gully|kläranlage/i, not: /kabelkanal|kanaldeckel/i, tasks: [
      { k: 'kanalbetrieb', t: 'Stadtentwässerung / Kanalbetrieb informieren', w: 'Stadtentwässerung Bereitschaft', m: 'call',
        a: [
          'Bereitschaft ist informiert, Kanalspülwagen wird angefordert, ca. 25 Minuten.',
          'Wir sperren die Pumpstation flussabwärts ab und kommen raus, ca. 20 Minuten.',
          'Verstanden, Kanalarbeiter mit Messgerät sind unterwegs, ca. 15 Minuten.',
          'Trupp ist alarmiert, bitte Schachtdeckel nicht öffnen, ca. 20 Minuten.',
          'Danke, wir prüfen das Kanalnetz und sind in ca. 30 Minuten vor Ort.',
        ],
        f: ['Kanalbetrieb vor Ort, Spülfahrzeug im Einsatz.', 300, 900] },
    ]},
    { re: /öl(spur|austritt|fleck|film|sperre)|betriebsmittel|kraftstoff|diesel|benzin/i, not: /diebstahl/i, tasks: [
      { k: 'strassenmeisterei', t: 'Straßenmeisterei / Bauhof zur Ölspurbeseitigung anfordern', w: 'Straßenmeisterei', m: 'call',
        a: [
          'Fachfirma mit Nassreinigung ist beauftragt, ca. 45 Minuten.',
          'Bauhof kommt mit Bindemittel und Warnschildern, ca. 25 Minuten.',
          'Verstanden, wir schicken eine Kehrmaschine, ca. 30 Minuten.',
          'Kolonne ist unterwegs, bitte Ölspur bis dahin absichern, ca. 20 Minuten.',
          'Alles klar, Ölspurbeseitigung ist beauftragt, ca. 35 Minuten.',
        ],
        f: ['Fachfirma Ölspurbeseitigung eingetroffen.', 400, 1200] },
      { k: 'wasserbehoerde', t: 'Untere Wasserbehörde informieren (Gefahr für Gully / Gewässer?)', w: 'Untere Wasserbehörde (Rufbereitschaft)', m: 'call', p: 0.35,
        a: [
          'Danke, wir prüfen, ob ein Gewässer betroffen ist.',
          'Bitte Gullys abdichten, ein Kollege kommt raus.',
          'Verstanden, wir nehmen den Vorgang auf. Bitte Menge und Stoff dokumentieren.',
          'Danke für die Meldung. Falls etwas ins Gewässer gelangt, bitte sofort Ölsperre setzen.',
          'Alles klar, die Rufbereitschaft ist informiert und meldet sich bei Bedarf.',
        ] },
    ]},
    { re: /baum|äste|\bast\b|sturm|unwetter/i, tasks: [
      { k: 'bauhof', t: 'Bauhof / Straßenmeisterei informieren (Räumung, Absicherung)', w: 'Bauhof Rufbereitschaft', m: 'call',
        a: [
          'Kolonne mit Motorsäge und Radlader kommt, ca. 25 Minuten.',
          'Wir übernehmen die Absicherung und sind in ca. 30 Minuten da.',
          'Verstanden, wir schicken zwei Mann mit Lkw, ca. 20 Minuten.',
          'Bauhof ist alarmiert, Absperrmaterial kommt mit, ca. 25 Minuten.',
          'Alles klar, wir räumen die Strecke, ca. 35 Minuten.',
        ],
        f: ['Bauhof vor Ort, übernimmt Abtransport.', 300, 900] },
      { k: 'ordnungsamt_sperr', t: 'Ordnungsamt: Straßensperrung absprechen', w: 'Ordnungsamt', m: 'call', p: 0.5,
        a: [
          'Sperrung ist genehmigt, Umleitung wird ausgeschildert.',
          'Verstanden, wir informieren die Verkehrsbehörde.',
          'Alles klar, die Sperrung ist so in Ordnung.',
          'Danke, wir melden die Sperrung an Polizei und ÖPNV weiter.',
          'Verstanden, bitte Bescheid geben, sobald die Straße wieder frei ist.',
        ] },
    ]},
    { re: /wasserrohr|rohrbruch|hydrant|wasserleitung/i, tasks: [
      { k: 'wasserversorger', t: 'Wasserversorger informieren (Leitung absperren)', w: 'Wasserwerk Bereitschaft', m: 'call',
        a: [
          'Rohrnetzmeister kommt und schiebert ab, ca. 20 Minuten.',
          'Wir schicken den Bereitschaftsdienst, ca. 25 Minuten.',
          'Verstanden, Monteur ist unterwegs, ca. 15 Minuten.',
          'Bereitschaft ist alarmiert, wir sperren den Abschnitt ab, ca. 30 Minuten.',
          'Danke, Wasserwerk schickt einen Trupp, ca. 20 Minuten.',
        ],
        f: ['Wasserwerk vor Ort, Leitung abgeschiebert.', 300, 900] },
    ]},
    { re: /strom|trafo|umspann|oberleitung|freileitung|verteilerkasten|stromkasten|\bmast\b|hochspannung|photovoltaik|pv-anlage|solar/i, tasks: [
      { k: 'netzbetreiber', t: 'Netzbetreiber: Freischaltung anfordern', w: 'Netzleitstelle Strom', m: 'call',
        a: [
          'Freischaltung wird eingeleitet, bitte Rückmeldung abwarten, ca. 10 Minuten.',
          'Techniker ist unterwegs, bitte Abstand halten, ca. 20 Minuten.',
          'Verstanden, wir schalten frei und erden, ca. 15 Minuten.',
          'Netzleitstelle hat übernommen. Bis zur Freigabe gilt die Anlage als unter Spannung, ca. 15 Minuten.',
          'Alles klar, Schalttrupp ist alarmiert, ca. 25 Minuten.',
        ],
        f: ['Netzleitstelle: Anlage freigeschaltet und geerdet – Arbeiten freigegeben.', 180, 480] },
    ]},
    { re: /gleis|bahnübergang|\bzug\b|(güter|personen|regional|fern|reise|nahverkehrs)zug|eisenbahn|s-bahn|güterwagen|bahnhof|bahnstrecke|bahndamm|stellwerk|\bice\b/i, tasks: [
      { k: 'db', t: 'Notfallleitstelle DB: Strecke sperren lassen', w: 'Notfallleitstelle DB InfraGO', m: 'call',
        a: [
          'Strecke ist gesperrt, Notfallmanager wird alarmiert, ca. 30 Minuten.',
          'Sperrung veranlasst, Notfallmanager kommt, ca. 40 Minuten.',
          'Verstanden, Zugverkehr ist eingestellt, Notfallmanager ist unterwegs, ca. 35 Minuten.',
          'Beide Gleise sind gesperrt, Notfallmanager kommt, ca. 30 Minuten.',
          'Alles klar, Strecke ist dicht, Notfallmanager ist alarmiert, ca. 45 Minuten.',
        ],
        f: ['Notfallmanager DB eingetroffen.', 600, 1500] },
      { k: 'bahnerdung', t: 'Bahnerdung der Oberleitung anfordern', w: 'Notfallleitstelle DB InfraGO', m: 'call', p: 0.5,
        a: [
          'Oberleitung wird ausgeschaltet. Erdung nur durch den Notfallmanager, ca. 25 Minuten.',
          'Verstanden, Schaltanweisung läuft, Erdung folgt, ca. 30 Minuten.',
          'Oberleitung wird abgeschaltet, Notfallmanager bringt Erdungsgarnitur mit, ca. 35 Minuten.',
          'Alles klar, Freischaltung beantragt, bitte nicht vor Erdung annähern, ca. 30 Minuten.',
          'Zentralschaltstelle ist informiert, Ausschaltung läuft, ca. 25 Minuten.',
        ],
        f: ['Oberleitung ausgeschaltet und geerdet.', 600, 1500] },
    ]},
    { re: /straßenbahn|stadtbahn|u-bahn|linienbus|reisebus|schulbus|\bbus\b/i, tasks: [
      { k: 'verkehrsbetrieb', t: 'Verkehrsbetrieb informieren (Umleitung / Ersatzverkehr)', w: 'Betriebsleitstelle Verkehrsbetrieb', m: 'call',
        a: [
          'Danke, Linien werden umgeleitet, ein Ersatzbus kommt.',
          'Verkehrsmeister ist unterwegs.',
          'Verstanden, wir richten Schienenersatzverkehr ein.',
          'Alles klar, Fahrgastinformation wird aktualisiert.',
          'Danke für die Meldung, die betroffenen Linien fahren eine Umleitung.',
        ] },
    ]},
    { re: /autobahn|\bbab\b|kraftfahrstraße|schnellstraße/i, tasks: [
      { k: 'autobahnmeisterei', t: 'Autobahnmeisterei: Absicherung anfordern', w: 'Autobahnmeisterei', m: 'call',
        a: [
          'Sicherungsanhänger kommt, ca. 30 Minuten.',
          'Verstanden, wir schicken ein Sicherungsfahrzeug, ca. 25 Minuten.',
          'Alles klar, Absicherung ist unterwegs, ca. 20 Minuten.',
          'Kolonne mit Sicherungsanhänger ist alarmiert, ca. 35 Minuten.',
          'Autobahnmeisterei übernimmt die Absicherung, ca. 30 Minuten.',
        ],
        f: ['Autobahnmeisterei mit Sicherungsanhänger vor Ort.', 600, 1200] },
    ]},
    { re: /gefahrgut|gefahrstoff|chemi|säure|lauge|ammoniak|chlor|giftig|nitrose|reinigungsmittel|radioaktiv|strahl|ätzend/i, tasks: [
      { k: 'umweltamt', t: 'Untere Umweltbehörde informieren', w: 'Umweltamt Rufbereitschaft', m: 'call',
        a: [
          'Wir kommen mit Probenahme raus.',
          'Danke, bitte Messwerte dokumentieren, wir melden uns.',
          'Verstanden, der Umweltdienst ist informiert.',
          'Alles klar, bitte Boden und Kanal im Blick behalten.',
          'Danke für die Meldung, wir prüfen die Anlage im Nachgang.',
        ] },
      { k: 'warnung', t: 'Bevölkerung warnen (NINA / Warn-App, Durchsagen)', w: 'Einsatzleiter', m: 'funk', p: 0.6,
        a: [
          'Verstanden, Warnmeldung wird über die Leitstelle eingestellt.',
          'Verstanden, Lautsprecherdurchsagen laufen.',
          'Verstanden, NINA-Warnung ist raus, Bereich wird geräumt.',
          'Verstanden, Polizei unterstützt bei den Durchsagen.',
          'Verstanden, Bevölkerung wird gewarnt, Fenster und Türen schließen.',
        ] },
      { k: 'fuehrungsdienst', t: 'Führungsdienst / Kreisbrandmeister informieren', w: 'Kreisbrandmeister', m: 'call', p: 0.5,
        a: [
          'Bin informiert, komme zur Lage.',
          'Danke, haltet mich auf dem Laufenden.',
          'Verstanden, ich übernehme die Einsatzleitung.',
          'Alles klar, ich bin unterwegs und melde mich an der Einsatzstelle.',
          'Danke, ich bleibe telefonisch erreichbar.',
        ] },
      { k: 'tuis', t: 'TUIS-Fachberater (Chemie) anfordern', w: 'TUIS-Notrufzentrale', m: 'call', p: 0.35,
        a: [
          'Fachberater wird telefonisch zugeschaltet.',
          'Werkfeuerwehr schickt einen Fachberater.',
          'Verstanden, Datenblatt zum Stoff kommt per Fax.',
          'Alles klar, ein Chemiker berät euch telefonisch.',
          'TUIS ist informiert, Fachberater meldet sich gleich.',
        ] },
    ]},
    { re: /großbrand|großfeuer|lagerhalle|recycling|reifen|kunststoff|brand in (industrie|lager|werk\b|werksgelände|fabrik|halle|metall|chemie|großwäscherei)/i, tasks: [
      { k: 'warnung_rauch', t: 'Bevölkerung warnen: Rauch – Fenster und Türen geschlossen halten', w: 'Einsatzleiter', m: 'funk',
        a: [
          'Verstanden, NINA-Warnung wird eingestellt.',
          'Verstanden, Lautsprecherdurchsagen laufen.',
          'Verstanden, Rauchwarnung geht raus, Lüftungen bitte ausschalten.',
          'Verstanden, Anwohner im Abwind werden gewarnt.',
          'Verstanden, Warnung ist raus, Polizei sperrt die Zufahrten.',
        ] },
      { k: 'kbm_gross', t: 'Kreisbrandmeister informieren', w: 'Kreisbrandmeister', m: 'call', p: 0.6,
        a: [
          'Ich bin unterwegs.',
          'Danke, ich komme zur Einsatzstelle.',
          'Verstanden, ich übernehme die Gesamteinsatzleitung.',
          'Bin informiert, ruft mich, wenn ihr Unterstützung braucht.',
          'Alles klar, ich alarmiere den Führungsstab.',
        ] },
      { k: 'luftmessung', t: 'Umweltamt: Luftmessung im Abwind anfordern', w: 'Umweltamt Rufbereitschaft', m: 'call', p: 0.4,
        a: [
          'Messfahrzeug wird losgeschickt.',
          'Verstanden, wir messen im Abwind.',
          'Alles klar, der Messtrupp ist alarmiert.',
          'Danke, wir prüfen die Schadstoffwerte und melden uns.',
          'Messwagen ist unterwegs, wir geben die Ergebnisse sofort durch.',
        ] },
    ]},
    { re: /wohnungsbrand|zimmerbrand|küchenbrand|kellerbrand|dachstuhl|wohnhaus|brand in (mehrfamilien|einfamilien|wohn|hochhaus|reihenhaus|doppelhaus)/i, tasks: [
      { k: 'energie', t: 'Energieversorger: Strom/Gas im Gebäude abschalten', w: 'Stadtwerke Entstörung', m: 'call', p: 0.5,
        a: [
          'Monteur kommt und klemmt den Hausanschluss ab.',
          'Verstanden, wir schalten das Gebäude stromlos.',
          'Alles klar, Gas wird am Hausanschluss abgesperrt.',
          'Entstörungsdienst ist informiert und übernimmt.',
          'Danke, wir trennen Strom und Gas für das Gebäude.',
        ] },
      { k: 'unterbringung', t: 'Ordnungsamt: Unterbringung für Bewohner organisieren', w: 'Ordnungsamt Bereitschaft', m: 'call', p: 0.5,
        a: [
          'Notunterkunft im Hotel ist organisiert.',
          'Wir holen die Bewohner ab.',
          'Verstanden, eine Turnhalle wird geöffnet.',
          'Alles klar, das Ordnungsamt kümmert sich um die Unterbringung.',
          'Danke, Ersatzwohnungen werden geprüft.',
        ] },
    ]},
    { re: /einsturz|eingestürzt|statik|gebäudeschaden|explosion|baugerüst|\bkran\b|baukran|autokran|kranunfall/i, not: /hasenbau/i, tasks: [
      { k: 'bauaufsicht', t: 'Bauaufsicht / Statiker anfordern', w: 'Bauaufsichtsamt Bereitschaft', m: 'call',
        a: [
          'Statiker kommt zur Beurteilung, ca. 30 Minuten.',
          'Bitte Gebäude nicht betreten bis zur Freigabe, Statiker kommt, ca. 25 Minuten.',
          'Verstanden, die Bauaufsicht ist alarmiert, ca. 35 Minuten.',
          'Prüfstatiker ist unterwegs, ca. 40 Minuten.',
          'Alles klar, wir beurteilen die Standsicherheit vor Ort, ca. 30 Minuten.',
        ],
        f: ['Statiker vor Ort, beurteilt die Standsicherheit.', 600, 1500] },
    ]},
    { re: /pferd|\bkuh|kühe|rinder|schwein|\bschaf|ziege|\bstall|viehtransport|bauernhof/i, tasks: [
      { k: 'veterinaer', t: 'Veterinäramt / Tierhalter verständigen', w: 'Veterinäramt', m: 'call', p: 0.7,
        a: [
          'Amtstierarzt ist informiert.',
          'Der Halter ist unterwegs.',
          'Verstanden, ein Tierarzt kommt raus.',
          'Alles klar, wir kümmern uns um die Tiere.',
          'Danke, das Veterinäramt übernimmt.',
        ] },
    ]},
    { re: /\breh\b|wild(schwein|unfall|tier)|hirsch|fuchs/i, tasks: [
      { k: 'jagd', t: 'Jagdpächter / Förster informieren', w: 'Jagdpächter', m: 'call',
        a: [
          'Ich komme raus und kümmere mich um das Tier.',
          'Verstanden, ich bin unterwegs.',
          'Alles klar, der Jagdpächter ist informiert.',
          'Danke, ich übernehme die Nachsuche.',
          'Bin informiert, ich kläre das mit dem Förster.',
        ] },
    ]},
    { re: /katze|hund|vogel|\bschwan|schwäne|tier/i, not: /wildtier|tiergarten|vogelscheuche/i, tasks: [
      { k: 'tierheim', t: 'Tierheim / Tierrettung informieren', w: 'Tierheim', m: 'call', p: 0.6,
        a: [
          'Wir können das Tier aufnehmen.',
          'Verstanden, wir holen das Tier ab.',
          'Alles klar, ein Pfleger kommt mit Transportbox.',
          'Danke, die Tierrettung ist informiert.',
          'Wir haben Platz, bringt es gern vorbei.',
        ] },
    ]},
    { re: /wald|forst|moor|heide/i, tasks: [
      { k: 'foerster', t: 'Förster / Forstamt informieren', w: 'Revierförster', m: 'call',
        a: [
          'Bin unterwegs und kenne die Waldwege.',
          'Ich schicke euch die Nummer des Rettungspunkts.',
          'Verstanden, ich lotse euch zur Einsatzstelle.',
          'Alles klar, das Forstamt ist informiert.',
          'Danke, ich weise eure Fahrzeuge ein.',
        ] },
      { k: 'warnung_wald', t: 'Bevölkerung warnen (Rauch, Gebiet meiden)', w: 'Einsatzleiter', m: 'funk', p: 0.4,
        a: [
          'Verstanden, Warnung geht raus.',
          'Verstanden, Gebiet wird gesperrt.',
          'Verstanden, Polizei sperrt die Wanderwege.',
          'Verstanden, NINA-Warnung ist eingestellt.',
          'Verstanden, Anwohner werden informiert.',
        ] },
    ]},
    { re: /flächenbrand|feld|acker|getreide|stroh|böschung|wiese/i, tasks: [
      { k: 'landwirt', t: 'Landwirt mit Güllefass / Grubber anfragen (Wasser, Schneise)', w: 'Landwirt', m: 'call', p: 0.5,
        a: [
          'Ich komme mit dem Grubber und ziehe eine Schneise.',
          'Güllefass mit Wasser ist unterwegs.',
          'Verstanden, ich bringe Wasser mit.',
          'Alles klar, ich grubbere den Rand ab.',
          'Ich hole noch einen Nachbarn mit Fass dazu.',
        ] },
    ]},
    { re: /verkehrsunfall|\bvu\b|auffahr|pkw|lkw|motorrad|transporter|zapfsäule/i, tasks: [
      { k: 'abschlepp', t: 'Abschleppdienst bestellen', w: 'Abschleppdienst', m: 'call',
        a: [
          'Abschlepper ist unterwegs, ca. 30 Minuten.',
          'Wir schicken einen Kran-Abschlepper, ca. 40 Minuten.',
          'Verstanden, Bergefahrzeug ist alarmiert, ca. 25 Minuten.',
          'Alles klar, wir kommen mit dem Plateau, ca. 20 Minuten.',
          'Abschleppdienst ist unterwegs, ca. 35 Minuten.',
        ],
        f: ['Abschleppdienst eingetroffen.', 600, 1500] },
    ]},
    { re: /tankstelle|zapfsäule/i, tasks: [
      { k: 'tankstellenbetreiber', t: 'Tankstellenbetreiber: Not-Aus bestätigen lassen', w: 'Tankstellenpächter', m: 'call',
        a: [
          'Not-Aus ist gedrückt, die Zapfsäulen sind stromlos.',
          'Verstanden, die Anlage ist abgeschaltet.',
          'Alles klar, der Tankbereich ist gesperrt.',
          'Pächter ist informiert und kommt.',
          'Danke, alle Zapfsäulen sind außer Betrieb.',
        ] },
    ]},
    { re: /^(?=.*(schule|kita|kindergarten|\bhort\b|internat))(?=.*(brand|feuer|rauch|gas|geruch|bomb|amok|explosion|chemikal|räum|evakuier))/i, tasks: [
      { k: 'schulleitung', t: 'Schulleitung / Träger informieren', w: 'Schulleitung', m: 'call',
        a: [
          'Wir sammeln die Kinder am Sammelplatz, die Lehrer zählen durch.',
          'Verstanden, die Schule wird geräumt.',
          'Alles klar, der Schulträger ist informiert.',
          'Alle Klassen sind am Sammelplatz und vollzählig.',
          'Danke, wir informieren die Eltern.',
        ] },
      { k: 'eltern', t: 'Elterninfo- und Sammelstelle einrichten lassen', w: 'Einsatzleiter', m: 'funk', p: 0.4,
        a: [
          'Verstanden, die Sammelstelle ist in der Turnhalle nebenan.',
          'Verstanden, die Eltern werden betreut.',
          'Verstanden, die Sammelstelle ist eingerichtet.',
          'Verstanden, die Elterninformation läuft.',
          'Verstanden, die Polizei unterstützt an der Sammelstelle.',
        ] },
    ]},
    { re: /krankenhaus|klinik|altenheim|seniorenheim|pflegeheim|altersheim|betreutes wohnen/i, tasks: [
      { k: 'heimleitung', t: 'Heim- / Klinikleitung informieren', w: 'Heimleitung', m: 'call',
        a: [
          'Wir stellen Pflegepersonal und Bewohnerlisten bereit.',
          'Verstanden, die Klinikleitung ist informiert.',
          'Alles klar, die Station wird geräumt.',
          'Danke, die Pflegekräfte unterstützen bei der Evakuierung.',
          'Die Bewohnerliste liegt bereit.',
        ] },
      { k: 'ersatz', t: 'Ersatzunterbringung für Bewohner/Patienten organisieren', w: 'Ordnungsamt Bereitschaft', m: 'call', p: 0.5,
        a: [
          'Eine Partnereinrichtung nimmt die Bewohner auf.',
          'Verstanden, Ersatzbetten sind organisiert.',
          'Alles klar, wir verlegen in das Nachbarhaus.',
          'Danke, die Unterbringung ist geklärt.',
          'Eine Turnhalle wird als Notquartier vorbereitet.',
        ] },
    ]},
    { re: /massenanfall|manv|großunfall|mehrere verletzte|viele verletzte/i, tasks: [
      { k: 'lna', t: 'LNA und OrgL alarmieren', w: 'Einsatzleiter', m: 'funk',
        a: [
          'Verstanden, LNA und OrgL sind alarmiert.',
          'Verstanden, LNA ist unterwegs.',
          'Verstanden, OrgL übernimmt die Abschnittsleitung.',
          'Verstanden, beide sind alarmiert und auf Anfahrt.',
          'Verstanden, die Rettungsdienstleitung ist informiert.',
        ] },
      { k: 'kh_vorab', t: 'Umliegende Krankenhäuser vorinformieren', w: 'Notaufnahmen', m: 'call',
        a: [
          'Die Notaufnahme ist informiert, der Schockraum wird freigehalten.',
          'Verstanden, wir nehmen Patienten auf.',
          'Alles klar, die Kliniken sind vorgewarnt.',
          'Danke, wir aktivieren den Alarmplan.',
          'Die Bettenkapazität ist gemeldet.',
        ] },
    ]},
    { re: /lebensmittel|lebkuchen|vergiftung|salmonell|kantine|restaurant|imbiss|großküche/i, tasks: [
      { k: 'gesundheitsamt', t: 'Gesundheitsamt / Lebensmittelüberwachung informieren', w: 'Gesundheitsamt Bereitschaft', m: 'call',
        a: [
          'Wir nehmen Proben, bitte die Lebensmittel sicherstellen.',
          'Verstanden, die Lebensmittelkontrolle ist informiert.',
          'Alles klar, der Betrieb wird geprüft.',
          'Danke, wir ermitteln die Ursache.',
          'Das Gesundheitsamt übernimmt den Fall.',
        ] },
    ]},
    { re: /hochwasser|überflut|überschwemm|starkregen|deich|keller unter wasser|wasser im keller/i, tasks: [
      { k: 'deich', t: 'Wasserbehörde / Deichverband informieren', w: 'Deichverband', m: 'call', p: 0.6,
        a: [
          'Der Pegel wird überwacht, Deichläufer sind unterwegs.',
          'Verstanden, der Deich wird kontrolliert.',
          'Alles klar, die Wasserbehörde ist informiert.',
          'Danke, wir prüfen die Schöpfwerke.',
          'Der Deichverband ist alarmiert.',
        ] },
      { k: 'sandsack', t: 'Bauhof: Sandsäcke anfordern', w: 'Bauhof Rufbereitschaft', m: 'call', p: 0.5,
        a: [
          'Ein Lkw mit 500 Sandsäcken ist unterwegs.',
          'Verstanden, Sandsäcke werden geladen.',
          'Alles klar, Sand und Säcke kommen.',
          'Der Bauhof bringt eine Füllmaschine mit.',
          'Danke, eine Palette Sandsäcke ist unterwegs.',
        ] },
    ]},
    { re: /person im wasser|ertrink|eingebrochen|boot|schiff|kanu|treibt|\bhafen|fähre/i, tasks: [
      { k: 'wsp', t: 'Wasserschutzpolizei / WSA informieren', w: 'Wasserschutzpolizei', m: 'call', p: 0.6,
        a: [
          'Ein Boot ist unterwegs.',
          'Die Schifffahrt auf dem Abschnitt wird gestoppt.',
          'Verstanden, die Wasserschutzpolizei übernimmt.',
          'Alles klar, das WSA ist informiert.',
          'Danke, wir sperren den Abschnitt.',
        ] },
    ]},
    { re: /flugzeug|flughafen|segelflug|ultraleicht|heißluftballon|hubschrauber|drohne/i, tasks: [
      { k: 'bfu', t: 'Flugsicherung / BFU informieren', w: 'BFU Bereitschaft', m: 'call',
        a: [
          'Unfall ist aufgenommen. Bitte keine Wrackteile bewegen!',
          'Verstanden, ein Ermittler kommt.',
          'Alles klar, die Flugsicherung ist informiert.',
          'Danke, bitte die Unfallstelle sichern.',
          'Die BFU übernimmt die Untersuchung.',
        ] },
    ]},
    { re: /brandmelde|\bbma\b|rauchmelder/i, tasks: [
      { k: 'betreiber', t: 'Objektverantwortlichen / Betreiber erreichen', w: 'Objektverantwortlicher', m: 'call',
        a: [
          'Ich komme mit dem Schlüssel.',
          'Der Haustechniker ist unterwegs zur BMZ.',
          'Verstanden, ich bin auf dem Weg.',
          'Alles klar, der Betreiber ist informiert.',
          'Der Objektverantwortliche kommt zur Einsatzstelle.',
        ] },
    ]},
    { re: /aufzug|fahrstuhl/i, tasks: [
      { k: 'aufzug', t: 'Aufzugsnotdienst verständigen', w: 'Aufzugsnotdienst', m: 'call',
        a: [
          'Ein Techniker ist auf dem Weg.',
          'Verstanden, der Notdienst kommt.',
          'Alles klar, ein Monteur ist unterwegs.',
          'Danke, der Aufzug wird befreit.',
          'Der Aufzugsnotdienst übernimmt.',
        ] },
    ]},
    { re: /kirche|\bdom\b|museum|denkmal|\bschloss|\bburg\b|kloster/i, tasks: [
      { k: 'kulturgut', t: 'Eigentümer / Denkmalbehörde informieren (Kulturgutschutz)', w: 'Denkmalbehörde', m: 'call', p: 0.6,
        a: [
          'Wir schicken jemanden für die Bergung der Kulturgüter.',
          'Verstanden, der Eigentümer ist informiert.',
          'Alles klar, die Denkmalbehörde kommt.',
          'Danke, bitte die Kunstwerke schützen.',
          'Ein Restaurator ist unterwegs.',
        ] },
    ]},
    { re: /fest\b|konzert|stadion|festival|kirmes|jahrmarkt|veranstaltung|weihnachtsmarkt/i, tasks: [
      { k: 'veranstalter', t: 'Veranstalter / Ordnungsamt informieren', w: 'Veranstaltungsleitung', m: 'call',
        a: [
          'Wir machen eine Durchsage und halten die Rettungswege frei.',
          'Verstanden, die Veranstaltung wird unterbrochen.',
          'Alles klar, der Ordnungsdienst unterstützt.',
          'Danke, das Ordnungsamt ist informiert.',
          'Der Veranstalter sperrt den Bereich ab.',
        ] },
    ]},
    { re: /ruhestörung|lärm|randal/i, tasks: [
      { k: 'ordnungsamt_laerm', t: 'Ordnungsamt informieren', w: 'Ordnungsamt', m: 'call', p: 0.5,
        a: [
          'Wir übernehmen die Anzeige.',
          'Verstanden, das Ordnungsamt ist informiert.',
          'Alles klar, wir kümmern uns.',
          'Danke, die Streife des Ordnungsamts ist unterwegs.',
          'Der Vorgang ist aufgenommen.',
        ] },
    ]},
    { re: /kohlenmonoxid|\bco[- ]|rauchgas|kamin|schornstein/i, tasks: [
      { k: 'schornsteinfeger', t: 'Bezirksschornsteinfeger anfordern (Feuerstätte prüfen / stilllegen)', w: 'Bezirksschornsteinfeger', m: 'call',
        a: [
          'Ich komme vorbei und lege die Feuerstätte still.',
          'Ich bin gleich da, bis dahin bitte nicht heizen.',
          'Verstanden, ich prüfe die Abgasanlage.',
          'Alles klar, der Schornsteinfeger ist unterwegs.',
          'Danke, ich messe den CO-Wert nach.',
        ] },
    ]},
    { re: /bürobrand|fassadenbrand|hotel|baumarkt|supermarkt|kaufhaus|möbelhaus|einkaufszentrum|brand in (büro|geschäft|laden|gaststätte)/i, tasks: [
      { k: 'eigentuemer', t: 'Eigentümer / Hausverwaltung / Filialleitung erreichen', w: 'Eigentümer', m: 'call',
        a: [
          'Ich komme sofort mit den Schlüsseln.',
          'Der Hausmeister ist unterwegs, die Pläne liegen im FSD.',
          'Verstanden, ich bin auf dem Weg.',
          'Alles klar, die Hausverwaltung ist informiert.',
          'Die Filialleitung kommt zur Einsatzstelle.',
        ] },
    ]},
  ];

  const BESETZT = ['Besetzt … bitte gleich nochmal versuchen.', 'Niemand geht ran. Später nochmal versuchen.', 'Warteschleife – Verbindung abgebrochen.'];

  /* ------------------------------------------------------------------
   * SPEICHER
   * ------------------------------------------------------------------ */
  // Jeder Einsatz hat einen eigenen Schlüssel, damit sich Hauptfenster und Einsatzfenster
  // nicht gegenseitig überschreiben. Zähler liegen getrennt, jeder hat nur einen Schreiber.
  const P = 'lssmz_';
  const getJ = (k, d) => { try { const v = localStorage.getItem(P + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const setJ = (k, v) => { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) {} };
  const delJ = k => { try { localStorage.removeItem(P + k); } catch (e) {} };
  const getM = id => getJ('m_' + id, null);
  const setM = (id, m) => setJ('m_' + id, m);
  const allIds = () => Object.keys(localStorage).filter(k => k.startsWith(P + 'm_')).map(k => k.slice(P.length + 2));
  const incr = (k, n) => setJ(k, (getJ(k, 0) || 0) + n);
  // Status: 0 offen, 1 erledigt, 2 wartet auf Rückmeldung (ist sie fällig, muss quittiert werden)
  const ready = x => x.s === 2 && Date.now() >= x.due;
  // Spiel-Schnittstellen nach Forumsstandard im sessionStorage zwischenspeichern (max. alle 5 Minuten neu)
  async function api(name, url) {
    const uid = typeof window.user_id !== 'undefined' ? window.user_id : null;
    try {
      const c = JSON.parse(sessionStorage.getItem(name));
      if (c && c.value && c.user_id === uid && Date.now() - c.lastUpdate < 5 * 60000) return c.value;
    } catch (e) {}
    const value = await fetch(url).then(r => r.json());
    try { sessionStorage.setItem(name, JSON.stringify({ value, lastUpdate: Date.now(), user_id: uid })); } catch (e) {}
    return value;
  }
  const istVerband = el => !!(el && el.closest('[id^="mission_list"][id*="alliance"]'));

  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

  function tasksFor(id, name) {
    const r = rng(parseInt(String(id).slice(-9), 10) || 1);
    const out = [], seen = new Set();
    for (const rule of RULES) {
      if (!rule.re.test(name) || (rule.not && rule.not.test(name))) continue;
      for (const t of rule.tasks) {
        const roll = r();
        if (seen.has(t.k) || (t.p !== undefined && roll > t.p)) continue;
        seen.add(t.k); out.push({ k: t.k, s: 0 }); // s: 0 offen, 1 erledigt, 2 wartet auf Rückmeldung, 3 Rückmeldung da (quittieren)
      }
    }
    return out;
  }
  const TASK = {}; RULES.forEach(rl => rl.tasks.forEach(t => { TASK[t.k] = t; }));
  const offen = m => m.t.filter(x => x.s !== 1).length;

  function ensureMission(id, name) {
    const ex = getM(id); if (ex) return ex;
    const t = tasksFor(id, name);
    if (!t.length) return null;
    const m = { n: name, t, c: Date.now() };
    setM(id, m);
    return m;
  }

  const css = `
    .lssmz-panel{border:1px solid #c9a227;border-radius:4px;margin:8px 0;background:rgba(201,162,39,.08)}
    .lssmz-panel h4{margin:0;padding:6px 10px;background:rgba(201,162,39,.25);font-size:14px;display:flex;justify-content:space-between}
    .lssmz-row{display:flex;gap:8px;align-items:flex-start;padding:6px 10px;border-top:1px solid rgba(0,0,0,.08)}
    .lssmz-row .txt{flex:1}
    .lssmz-row .ans{font-size:12px;opacity:.85;margin-top:2px;font-style:italic}
    .lssmz-done .txt{opacity:.55;text-decoration:line-through}
    .lssmz-badge{display:inline-block;margin-left:4px;padding:0 5px;border-radius:8px;background:#c9a227;color:#000;font-size:11px;font-weight:bold}
    .lssmz-badge.alert{background:#d9534f;color:#fff}
    #lssmz-toasts{position:fixed;right:12px;bottom:12px;z-index:99999;display:flex;flex-direction:column;gap:6px;max-width:340px}
    .lssmz-toast{background:#222;color:#fff;border-left:4px solid #c9a227;padding:8px 10px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:pointer;font-size:13px}
    #lssmz-stats{position:fixed;left:8px;bottom:8px;z-index:9999;background:rgba(0,0,0,.75);color:#fff;font-size:12px;padding:4px 8px;border-radius:4px}
    #lssmz-ppbtn{margin:8px 0 0 6px}
    .lssmz-fenster{position:fixed;top:52px;right:12px;width:560px;max-width:95vw;max-height:75vh;display:flex;flex-direction:column;z-index:100000;background:#2b2b2b;color:#eee;border:1px solid #c9a227;border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.6);font-size:13px}
    .lssmz-fenster .hd{display:flex;gap:6px;align-items:center;padding:8px;border-bottom:1px solid #444}
    .lssmz-fenster .hd .tab{cursor:pointer;padding:3px 10px;border-radius:4px;background:#3a3a3a}
    .lssmz-fenster .hd .tab.on{background:#c9a227;color:#000;font-weight:bold}
    .lssmz-fenster .hd .x{margin-left:auto;cursor:pointer;font-size:18px;padding:0 6px}
    .lssmz-fenster .tools{display:flex;gap:6px;padding:8px;flex-wrap:wrap;align-items:center}
    .lssmz-fenster input,.lssmz-fenster select{background:#1e1e1e;color:#eee;border:1px solid #555;border-radius:4px;padding:3px 6px}
    .lssmz-fenster input.q,.lssmz-fenster input.rq,.lssmz-fenster input.kq{flex:1;min-width:180px}
    .lssmz-fenster .info{padding:0 8px 6px;font-size:11px;opacity:.75}
    .lssmz-fenster .list{overflow:auto;flex:1;border-top:1px solid #444}
    .lssmz-fenster .it{display:flex;gap:8px;align-items:center;padding:5px 8px;border-bottom:1px solid #383838}
    .lssmz-fenster .it:hover{background:#353535}
    .lssmz-fenster .it .main{flex:1;min-width:0}
    .lssmz-fenster .it .sub{font-size:11px;opacity:.75}
    .lssmz-fenster .tag{display:inline-block;background:#444;border-radius:3px;padding:0 4px;margin:1px 2px 0 0;font-size:11px}
    .lssmz-fenster .go{cursor:pointer;background:#c9a227;color:#000;border:0;border-radius:4px;padding:2px 8px;font-weight:bold}
    .lssmz-fenster a{color:#f0c040}
    #lssmz-set{position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
    #lssmz-set .box{background:#2b2b2b;color:#eee;border:1px solid #c9a227;border-radius:6px;width:520px;max-width:95vw;max-height:85vh;overflow:auto;padding:12px 16px;font-size:13px;zoom:var(--lssmz-zoom,1)}
    #lssmz-set h3{margin:0 0 8px;font-size:17px;color:#f0c040}
    #lssmz-set h4{margin:12px 0 4px;font-size:14px;border-bottom:1px solid #444;padding-bottom:3px}
    #lssmz-set label{display:flex;gap:8px;align-items:center;font-weight:normal;margin:3px 0}
    #lssmz-set .zeile{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0}
    #lssmz-set input[type=number]{width:80px;background:#1e1e1e;color:#eee;border:1px solid #555;border-radius:4px;padding:2px 6px}
    #lssmz-set .knoepfe{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
    #lssmz-setbtn{margin:8px 0 0 4px}
    .lssmz-v{display:inline-block;margin-right:3px;cursor:default}
    #lssmz-vfilter{display:flex;gap:4px;align-items:center;margin:4px 0;flex-wrap:wrap;font-size:12px}
    #lssmz-vfilter button{padding:1px 7px}
    #lssmz-vfilter button.aus{opacity:.35;text-decoration:line-through}
    body.lssmz-v-g-aus .missionSideBarEntry[data-lssmz-v="g"],
    body.lssmz-v-m-aus .missionSideBarEntry[data-lssmz-v="m"],
    body.lssmz-v-k-aus .missionSideBarEntry[data-lssmz-v="k"]{display:none!important}
    a.aao_btn.lssmz-fehlt{opacity:.45}
    a.aao_btn.lssmz-fehlt .label{display:none}
    .lssmz-fenster .rech{display:none;flex-direction:column;overflow:auto;flex:1;border-top:1px solid #444}
    .lssmz-fenster .rech .box{padding:8px;border-bottom:1px solid #383838}
    .lssmz-fenster .rech .h{font-weight:bold;color:#f0c040;margin-bottom:4px}
    .lssmz-fenster .pick{cursor:pointer}
    .lssmz-fenster .sb{background:#444;color:#eee;border:0;border-radius:3px;padding:0 7px;margin-left:2px;cursor:pointer}
    .lssmz-fenster .ok{color:#5cb85c}.lssmz-fenster .mid{color:#f0ad4e}.lssmz-fenster .bad{color:#ff6b6b}
    .lssmz-fenster .warn{color:#f0ad4e;font-size:12px}
    .lssmz-fenster table.kost{width:100%;border-collapse:collapse;font-size:13px}
    .lssmz-fenster table.kost td{padding:2px 4px;border-bottom:1px solid #383838;vertical-align:top}
    .lssmz-fenster table.kost td.r{text-align:right;white-space:nowrap}
    .lssmz-fenster table.kost tr.sum td{font-weight:bold;border-top:2px solid #c9a227;border-bottom:0}
    .lssmz-fenster .rb{display:inline-block;background:#dc3545;color:#fff;border-radius:3px;padding:0 4px;margin-left:4px;font-size:11px;font-weight:bold}
    .lssmz-fenster .wbox label{display:inline-block;margin:2px 10px 2px 0;font-weight:normal;cursor:pointer}
    .lssmz-fenster .wbox select{max-width:100%}
    .lssmz-fenster,.lssmz-fenster input,.lssmz-fenster select,.lssmz-fenster button,.lssmz-fenster table,.lssmz-fenster label{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
    .lssmz-fenster{line-height:1.42857}`;
  const addCss = () => { if (document.getElementById('lssmz-css')) return; const s = document.createElement('style'); s.id = 'lssmz-css'; s.textContent = css + `
    .lssmz-panel,.lssmz-badge,.lssmz-toast,#lssmz-stats,.lssmz-fenster,#lssmz-set .box{zoom:${CFG.zoom}}`; document.head.appendChild(s); };
  const fmt = ts => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ------------------------------------------------------------------
   * EINSATZFENSTER
   * ------------------------------------------------------------------ */
  function missionWindow(id) {
    const h1 = document.getElementById('missionH1');
    if (!h1) return;
    try { if (istVerband(window.parent.document.getElementById('mission_' + id))) return; } catch (e) {}
    const name = (h1.textContent || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
    if (!ensureMission(id, name)) return;
    addCss();
    const panel = document.createElement('div');
    panel.className = 'lssmz-panel';
    const header = document.querySelector('.mission_header_info');
    const cf = header && header.nextElementSibling;
    if (header) (cf && cf.classList.contains('clearfix') ? cf : header).insertAdjacentElement('afterend', panel);
    else h1.insertAdjacentElement('afterend', panel);
    const busy = new Set();
    // Änderung an einer Aufgabe: frisch lesen, ändern, sofort schreiben
    // merkt sich vorher den alten Stand (für ↶ Rückgängig) und zählt Erledigtes mit
    const change = (i, fn) => {
      const m = getM(id); if (!m || !m.t[i]) return;
      const vorher = JSON.parse(JSON.stringify(m.t[i]));
      if (fn(m.t[i]) === false) return;
      m.h = (m.h || []).concat([{ i, v: vorher }]).slice(-20);
      if (m.t[i].s === 1 && vorher.s !== 1) incr('ok', 1);
      setM(id, m);
    };
    const rueckgaengig = () => {
      const m = getM(id); if (!m || !m.h || !m.h.length) return;
      const { i, v } = m.h.pop();
      if (m.t[i] && m.t[i].s === 1 && v.s !== 1) incr('ok', -1);
      m.t[i] = v;
      setM(id, m);
    };

    function render() {
      const m = getM(id);
      if (!m) { panel.remove(); return; }
      const rows = m.t.map((x, i) => {
        const d = TASK[x.k]; if (!d) return '';
        const icon = d.m === 'funk' ? '📻' : '📞';
        let btn = '', info = x.ans ? `<div class="ans">${esc(x.ans)}</div>` : '';
        if (busy.has(i)) btn = `<button class="btn btn-xs btn-default" disabled>${d.m === 'funk' ? 'Funkt…' : 'Wählt…'}</button>`;
        else if (x.s === 0) btn = `<button class="btn btn-xs btn-warning" data-i="${i}">${icon} ${d.m === 'funk' ? 'Funken' : 'Anrufen'}</button>`;
        else if (ready(x)) { info += `<div class="ans">📨 ${esc(x.fu)}</div>`; btn = `<button class="btn btn-xs btn-success" data-q="${i}">✔ Quittieren</button>`; }
        else if (x.s === 2) info += `<div class="ans">⏳ Rückmeldung erwartet ca. ${fmt(x.due)}</div>`;
        return `<div class="lssmz-row ${x.s === 1 ? 'lssmz-done' : ''}"><div class="txt">${icon} <b>${esc(d.t)}</b>${info}</div>${btn}</div>`;
      }).join('');
      const undo = `<button class="btn btn-xs btn-default" data-undo="1" title="Letzten Schritt rückgängig machen" ${m.h && m.h.length && !busy.size ? '' : 'disabled'}>↶</button>`;
      panel.innerHTML = `<h4><span>📋 Weitere Maßnahmen</span><span>${undo} ${offen(m)} offen</span></h4>${rows}`;
    }

    panel.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      e.preventDefault();
      if (b.dataset.undo) { if (!busy.size) rueckgaengig(); return render(); }
      if (b.dataset.q !== undefined) {
        change(+b.dataset.q, x => { if (!ready(x)) return false; x.s = 1; });
        return render();
      }
      const i = +b.dataset.i; const m = getM(id); if (!m) return;
      const d = TASK[m.t[i].k];
      busy.add(i); render();
      setTimeout(() => {
        busy.delete(i);
        const besetzt = d.m === 'call' && Math.random() < CFG.besetztChance;
        change(i, x => {
          if (x.s !== 0) return false;
          if (besetzt) { x.ans = `${d.w}: ${pick(BESETZT, Math.random)}`; return; }
          x.ans = `${d.w}: ${pick(d.a, Math.random)}`;
          if (d.f) { x.s = 2; x.fu = `${d.w}: ${d.f[0]}`; x.due = Date.now() + 1000 * (CFG.rueckmeldungMin + Math.random() * (CFG.rueckmeldungMax - CFG.rueckmeldungMin)); x.ans = x.ans.replace(/\d+ Minuten/, Math.round((x.due - Date.now()) / 60000) + ' Minuten'); }
          else { x.s = 1; }
        });
        render();
      }, 1500 + Math.random() * 3500);
    });

    setInterval(() => { if (!busy.size) render(); }, 3000); // fällige Rückmeldungen anzeigen
    window.addEventListener('storage', e => { if (e.key === P + 'm_' + id && !busy.size) render(); });
    render();
  }

  /* ------------------------------------------------------------------
   * HAUPTSEITE: Abzeichen, Rückmeldungen, Statistik
   * ------------------------------------------------------------------ */
  function mainPage() {
    addCss();
    const toasts = document.createElement('div'); toasts.id = 'lssmz-toasts'; document.body.appendChild(toasts);
    const stats = document.createElement('div'); stats.id = 'lssmz-stats'; document.body.appendChild(stats);
    stats.style.display = 'none';
    const toast = (txt, mid, fn) => {
      const t = document.createElement('div'); t.className = 'lssmz-toast'; t.textContent = txt;
      t.onclick = () => { if (fn) fn(); else if (mid && typeof window.lightboxOpen === 'function') window.lightboxOpen('/missions/' + mid); t.remove(); };
      toasts.appendChild(t); setTimeout(() => t.remove(), 20000);
    };
    let werbeListe = [];                     // Wachen ohne Werbephase
    const absent = {};                       // id -> wie oft nicht in der Liste
    const notified = new Set(getJ('n', []));  // bereits gemeldete Rückmeldungen

    function scan() {
      const entries = document.querySelectorAll('.missionSideBarEntry');
      if (!entries.length) return;
      const present = new Set(), msgs = [];
      let open = 0, newNote = false;
      entries.forEach(el => {
        const id = el.getAttribute('mission_id'); if (!id) return;
        if (istVerband(el)) { if (getM(id)) delJ('m_' + id); const b = el.querySelector('.lssmz-badge'); if (b) b.remove(); return; }
        present.add(id); absent[id] = 0;
        let name = '';
        try { name = JSON.parse(el.getAttribute('data-sortable-by')).caption || ''; } catch (e) {}
        const cap = document.getElementById('mission_caption_' + id);
        if (!name && cap) name = cap.firstChild.textContent.replace(/,\s*$/, '').trim();
        const m = ensureMission(id, name);
        let badge = cap && cap.parentNode.querySelector('.lssmz-badge');
        if (!m) { if (badge) badge.remove(); return; }
        const o = offen(m); open += o;
        let alert = false;
        m.t.forEach(x => {
          if (!ready(x)) return;
          alert = true;
          const nk = id + ':' + x.k;
          if (!notified.has(nk)) { notified.add(nk); newNote = true; msgs.push([`📨 ${m.n}: ${x.fu}`, id]); }
        });
        if (!cap || !AN('abzeichen')) { if (badge) badge.remove(); return; }
        if (!badge) { badge = document.createElement('span'); badge.className = 'lssmz-badge'; cap.insertAdjacentElement('afterend', badge); }
        const started = m.t.some(x => x.s !== 0 || x.ans);
        const txt = o ? `📋 ${o}` : '✅';
        if (badge.textContent !== txt) badge.textContent = txt;
        badge.style.background = !o ? '#5cb85c' : alert ? '#337ab7' : started ? '#f0ad4e' : '#d9534f';
        badge.style.color = !o ? '#fff' : alert ? '#fff' : started ? '#000' : '#fff';
        badge.title = o ? `${o} Maßnahme(n) offen` : 'Alle Maßnahmen erledigt';
      });
      // Einsätze, die aus der Liste verschwunden sind -> abgeschlossen
      for (const id of allIds()) {
        if (present.has(id)) continue;
        absent[id] = (absent[id] || 0) + 1;
        if (absent[id] < CFG.abschlussNachScans) continue;
        const m = getM(id); delJ('m_' + id); delete absent[id];
        if (!m) continue;
        const o = offen(m);
        if (o) { incr('miss', o); msgs.push([`⚠️ ${m.n} beendet – ${o} Maßnahme(n) vergessen!`, null]); }
        m.t.forEach(x => notified.delete(id + ':' + x.k)); newNote = true;
      }
      if (newNote) setJ('n', [...notified]);
      letzteOffen = open; zeigeStats();
      if (AN('meldungen')) msgs.slice(0, 5).forEach(([t, id]) => toast(t, id));
    }
    let letzteOffen = 0;
    function zeigeStats() {
      const teile = [];
      if (AN('massnahmen')) teile.push(`📋 Maßnahmen – offen: ${letzteOffen} · erledigt: ${getJ('ok', 0)} · vergessen: ${getJ('miss', 0)}`);
      if (werbeListe.length) teile.push(`<span class="lssmz-wb" style="cursor:pointer;color:#f0ad4e" title="${esc(werbeListe.join(', '))}">⚠️ ohne Werbephase: ${werbeListe.length}</span>`);
      stats.innerHTML = teile.join(' · ');
      stats.style.display = AN('statistik') && teile.length ? '' : 'none';
    }
    if (AN('massnahmen')) { scan(); setInterval(scan, CFG.scanIntervall); }
    zeigeStats();
    let panel = null;
    if (AN('personalPanel')) try { panel = personalPanel(); } catch (e) { console.warn('[LSS-Maßnahmen] Panel', e); }
    try { einstellButton(); } catch (e) {}
    if (AN('verletzte')) verletzte().catch(() => {});
    let werbeIds = [];
    const zeigeWerbung = () => { if (panel) panel.oeffne('g', true); else if (werbeIds[0] && typeof window.lightboxOpen === 'function') window.lightboxOpen(`/buildings/${werbeIds[0]}/hire`); };
    stats.addEventListener('click', e => { if (e.target.closest('.lssmz-wb')) zeigeWerbung(); });
    // Werbephasen prüfen
    let letzteWarnung = 0, letzteListe = '';
    async function werbeCheck() {
      if (!AN('werbeWarnung')) return;
      try {
        const b = await api('aBuildings', '/api/buildings');
        werbeListe = b.filter(brauchtWerbung).map(x => x.caption);
        werbeIds = b.filter(brauchtWerbung).map(x => x.id);
        const key = werbeListe.join('|');
        if (werbeListe.length && (key !== letzteListe || Date.now() - letzteWarnung > CFG.werbeWarnAlleMin * 60000)) {
          toast(`⚠️ Keine Werbephase, obwohl Personal fehlt: ${werbeListe.slice(0, 4).join(', ')}${werbeListe.length > 4 ? ` (+${werbeListe.length - 4})` : ''} – klicken zum Anzeigen`, null, zeigeWerbung);
          letzteWarnung = Date.now();
        }
        letzteListe = key;
        zeigeStats();
      } catch (e) {}
    }
    werbeCheck();
    setInterval(werbeCheck, 10 * 60000);
  }

  /* ------------------------------------------------------------------
   * PERSONAL- & GEBÄUDE-PANEL (Button neben „Ort suchen…“)
   * ------------------------------------------------------------------ */
  const TYPEN = { 0: 'Feuerwache', 1: 'Feuerwehrschule', 2: 'Rettungswache', 5: 'RTH-Station', 12: 'SEG', 4: 'Krankenhaus', 6: 'Polizeiwache', 7: 'Leitstelle', 9: 'THW', 18: 'Feuerwache (klein)', 19: 'Polizeiwache (klein)', 20: 'Rettungswache (klein)' };
  const pause = ms => new Promise(r => setTimeout(r, ms));

  function zentrieren(lat, lng) {
    const m = window.map;
    if (m && m.setView) m.setView([lat, lng], Math.max(m.getZoom ? m.getZoom() : 15, 15), { animate: true });
  }
  const oeffnen = url => { if (typeof window.lightboxOpen === 'function') window.lightboxOpen(url); else window.open(url, '_blank'); };

  // Wache unter Personalziel, aber keine Werbephase aktiv (und keine automatische Einstellung)?
  const brauchtWerbung = x => (x.personal_count_target || 0) > 0 && (x.personal_count || 0) < x.personal_count_target && !x.hiring_phase && !x.hiring_automatic;
  let FZT = null, SCH = {}, LB = null;   // Fahrzeugtypen, Lehrgänge und Gebäudetypen (LSSM-Schnittstelle)
  async function ladeGebaeude() {
    const [b, v, t, sc, lb] = await Promise.all([
      api('aBuildings', '/api/buildings'),
      api('aVehicles', '/api/vehicles'),
      fetch('https://api.lss-manager.de/de_DE/vehicles').then(r => r.json()).catch(() => null),
      fetch('https://api.lss-manager.de/de_DE/schoolings').then(r => r.json()).catch(() => null),
      fetch('https://api.lss-manager.de/de_DE/buildings').then(r => r.json()).catch(() => null),
    ]);
    FZT = t; LB = lb;
    if (sc) Object.values(sc).flat().forEach(x => { SCH[x.caption] = { l: x.staffList || x.caption, d: parseInt(x.duration, 10) || 0 }; });
    const fz = {};
    v.forEach(x => {
      const z = fz[x.building_id] = fz[x.building_id] || { n: 0, min: 0, voll: 0, ok: true };
      const typ = t && t[x.vehicle_type];
      const max = x.max_personnel_override || (typ ? typ.maxPersonnel : 0);
      z.n++;
      z.min += typ ? Math.min(typ.minPersonnel, max || typ.minPersonnel) : 0;
      z.voll += max;
      if (!typ && !x.max_personnel_override) z.ok = false;
    });
    return b.map(x => {
      const z = fz[x.id] || { n: 0, min: 0, voll: 0, ok: true };
      return { id: x.id, bt: x.building_type, n: x.caption, typ: TYPEN[x.building_type] || 'Gebäude', lat: x.latitude, lng: x.longitude,
        hp: x.hiring_phase || 0, wb: brauchtWerbung(x),
        p: x.personal_count || 0, ziel: x.personal_count_target || 0, f: z.n, min: z.min, voll: z.voll, ok: z.ok && !!t };
    }).sort((a, c) => a.n.localeCompare(c.n, 'de', { numeric: true }));
  }

  async function ladePersonal(gebaeude, fortschritt) {
    const mit = gebaeude.filter(g => g.p > 0), out = [];
    for (let i = 0; i < mit.length; i++) {
      const g = mit[i];
      fortschritt(i + 1, mit.length);
      try {
        const d = new DOMParser().parseFromString(await fetch(`/buildings/${g.id}/personals`).then(r => r.text()), 'text/html');
        d.querySelectorAll('table tbody tr').forEach(tr => {
          const td = tr.querySelectorAll('td'); if (td.length < 5) return;
          const t = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
          const aus = t(td[2]).split(/\s*,\s*/).filter(Boolean);
          out.push({ n: t(td[1]), a: aus, b: t(td[3]), s: t(td[4]), w: g.id });
        });
      } catch (e) {}
      await pause(250);
    }
    return out;
  }

  function personalPanel() {
    const form = document.getElementById('map_adress_search_form');
    if (!form || document.getElementById('lssmz-ppbtn')) return;
    const btn = document.createElement('button');
    btn.id = 'lssmz-ppbtn'; btn.type = 'button'; btn.className = 'btn btn-default btn-sm';
    btn.textContent = '👥 Personal & Wachen';
    form.insertAdjacentElement('afterend', btn);

    let pp = null, tab = 'p', geb = null, pers = null, laden = false, nurWb = false;
    const kosten = AN('kostenrechner') ? kostenModul(() => geb) : null;
    const gebMap = () => { const m = {}; (geb || []).forEach(g => { m[g.id] = g; }); return m; };

    function zeichnen() {
      if (!pp) return;
      const q = (pp.querySelector('.q').value || '').toLowerCase().split(/\s+/).filter(Boolean);
      const sel = pp.querySelector('.aus');
      const list = pp.querySelector('.list'), info = pp.querySelector('.info');
      const passt = txt => q.every(w => txt.includes(w));
      pp.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.t === tab));
      sel.style.display = tab === 'p' ? '' : 'none';
      const r = tab === 'r', kt = tab === 'k';
      pp.querySelector('.tools').style.display = r || kt ? 'none' : '';
      info.style.display = r || kt ? 'none' : '';
      list.style.display = r || kt ? 'none' : '';
      pp.querySelector('.rech').style.display = r ? 'flex' : 'none';
      const kb = pp.querySelector('.kosten'); if (kb) kb.style.display = kt ? 'flex' : 'none';
      if (kt) { if (kosten) kosten.zeigen(); return; }
      if (r) { if (geb) { treffer(); rechnerZeichnen(); } else pp.querySelector('.erg').innerHTML = '<div class="box">Lade Daten …</div>'; return; }
      if (!geb) { list.innerHTML = '<div class="it">Lade Gebäude …</div>'; return; }
      const gm = gebMap();
      if (tab === 'g') {
        const g = geb.filter(x => (!nurWb || x.wb) && passt(`${x.n} ${x.typ}`.toLowerCase()));
        const nWb = geb.filter(x => x.wb).length;
        info.innerHTML = `${g.length} von ${geb.length} Gebäuden` + (nWb || nurWb ? ` · <a href="#" class="nurwb">${nurWb ? 'alle anzeigen' : `⚠️ nur ohne Werbephase (${nWb})`}</a>` : '');
        list.innerHTML = g.map(x => `<div class="it"><button class="go" data-lat="${x.lat}" data-lng="${x.lng}" title="Auf Karte zentrieren">➤</button>
          <div class="main"><b>${esc(x.n)}</b><div class="sub">${esc(x.typ)} · ${x.f} Fahrzeuge</div>
          <div class="sub">Personal <b style="color:${x.f ? (x.p < x.min ? '#ff6b6b' : x.p < x.voll ? '#f0ad4e' : '#5cb85c') : 'inherit'}">${x.p}</b>${x.ziel ? ` / Ziel ${x.ziel}` : ''}${x.f ? ` · Fahrzeuge brauchen: mind. ${x.min}${x.ok ? '' : '?'}, voll ${x.voll}${x.ok ? '' : '?'}` : ''}</div>
          ${x.ziel ? `<div class="sub">${x.wb ? '<span class="bad">⚠️ keine Werbephase</span>' : x.hp ? `Werbephase: noch ${x.hp === 1 ? '<span class="mid">1 Tag</span>' : x.hp + ' Tage'}` : 'Personalziel erreicht'} · <a href="#" data-open="/buildings/${x.id}/hire">Werben</a></div>` : ''}</div>
          <a href="#" data-open="/buildings/${x.id}">Details</a></div>`).join('');
        return;
      }
      if (!pers) { list.innerHTML = `<div class="it">${laden ? 'Lade Personal …' : 'Noch nicht geladen.'}</div>`; return; }
      const f = sel.value;
      const p = pers.filter(x => (!f || x.a.includes(f)) && passt(`${x.n} ${x.a.join(' ')} ${x.b} ${x.s} ${gm[x.w] ? gm[x.w].n : ''}`.toLowerCase()));
      const st = getJ('pers_t', 0);
      info.innerHTML = `${p.length} von ${pers.length} Personen · Stand ${st ? fmt(st) : '–'} · <a href="#" class="reload">neu laden</a>`;
      const max = 400;
      list.innerHTML = p.slice(0, max).map(x => { const g = gm[x.w]; return `<div class="it">
          ${g ? `<button class="go" data-lat="${g.lat}" data-lng="${g.lng}" title="Wache auf Karte zentrieren">➤</button>` : ''}
          <div class="main"><b>${esc(x.n)}</b> <span class="sub">· ${esc(g ? g.n : '?')}</span>
          <div>${x.a.length ? x.a.map(a => `<span class="tag">${esc(a)}</span>`).join('') : '<span class="sub">keine Ausbildung</span>'}</div>
          <div class="sub">${esc(x.s || x.b || '')}</div></div>
          ${g ? `<a href="#" data-open="/buildings/${g.id}/personals">Wache</a>` : ''}</div>`; }).join('') +
        (p.length > max ? `<div class="it sub">… ${p.length - max} weitere – Suche eingrenzen</div>` : '');
    }

    /* ---------- Rechner ---------- */
    const auswahl = [];   // [{t: Fahrzeugtyp-ID, n: Anzahl}]
    const label = cap => (SCH[cap] ? SCH[cap].l : cap.replace(/[- ](Lehrgang|Ausbildung|Fortbildung|Schulung)$/i, ''));
    function anforderung(id) {
      const t = FZT[id]; const max = t.maxPersonnel || 0, min = t.minPersonnel || 0, aus = [];
      if (t.schooling) {
        const dep = Object.values(t.schooling)[0] || {};
        for (const [cap, r] of Object.entries(dep)) {
          const need = r.all ? max : (r.min || 0);
          if (need > 0) aus.push({ cap, l: label(cap), need, d: SCH[cap] ? SCH[cap].d : 0 });
        }
      }
      return { max, min, aus, wo: t.possibleBuildings || [] };
    }
    function bedarf() {
      let voll = 0, min = 0, wo = null; const aus = {};
      auswahl.forEach(a => {
        const r = anforderung(a.t);
        voll += r.max * a.n; min += r.min * a.n;
        wo = wo ? wo.filter(x => r.wo.includes(x)) : [...r.wo];
        r.aus.forEach(x => { const z = aus[x.l] = aus[x.l] || { l: x.l, cap: x.cap, need: 0, d: x.d }; z.need += x.need * a.n; });
      });
      return { voll, min, wo: wo || [], aus: Object.values(aus) };
    }
    const tage = n => n === 1 ? '1 Nacht' : `${n} Nächte`;
    const datum = n => new Date(Date.now() + n * 86400000).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

    function treffer() {
      const box = pp.querySelector('.treffer'), q = pp.querySelector('.rq').value.trim().toLowerCase();
      if (!FZT) { box.innerHTML = '<div class="it sub">Fahrzeugdaten (LSS-Manager) nicht erreichbar.</div>'; return; }
      if (!q) { box.innerHTML = ''; return; }
      const hits = Object.entries(FZT).filter(([, t]) => t.caption.toLowerCase().includes(q))
        .sort(([, a], [, b]) => (b.caption.toLowerCase().startsWith(q) - a.caption.toLowerCase().startsWith(q)) || a.caption.localeCompare(b.caption, 'de', { numeric: true })).slice(0, 10);
      box.innerHTML = hits.length ? hits.map(([id, t]) => { const r = anforderung(id); return `<div class="it pick" data-add="${id}">
        <div class="main"><b>${esc(t.caption)}</b><div class="sub">Besatzung ${r.min}–${r.max}${r.aus.length ? ' · ' + r.aus.map(x => `${esc(x.l)} ×${x.need}`).join(', ') : ''}</div></div>
        <button class="go" data-add="${id}">＋</button></div>`; }).join('') : '<div class="it sub">Kein Fahrzeug gefunden.</div>';
    }

    function rechnerZeichnen() {
      const aw = pp.querySelector('.auswahl'), erg = pp.querySelector('.erg');
      if (!auswahl.length) { aw.innerHTML = ''; erg.innerHTML = '<div class="box sub">Such oben ein Fahrzeug und klick es an. Du kannst auch mehrere Fahrzeuge zusammenstellen, z.B. für eine komplette neue Wache.</div>'; return; }
      aw.innerHTML = '<div class="box"><div class="h">Auswahl</div>' + auswahl.map((a, i) => `<div class="it">
        <div class="main"><b>${a.n}× ${esc(FZT[a.t].caption)}</b></div>
        <button class="sb" data-dec="${i}">−</button><button class="sb" data-inc="${i}">＋</button><button class="sb" data-rm="${i}">✕</button></div>`).join('') + '</div>';
      const b = bedarf(), maxD = Math.max(0, ...b.aus.map(x => x.d));
      const ausTxt = b.aus.length ? b.aus.map(x => `<span class="tag">${esc(x.l)} ×${x.need}${x.d ? ` · ${x.d} Tage` : ''}</span>`).join('') : '<span class="sub">keine Lehrgänge nötig</span>';
      let html = `<div class="box"><div class="h">Bedarf</div>
        Voll besetzt: <b>${b.voll}</b> Personen · zum Ausrücken mindestens: <b>${b.min}</b><div style="margin-top:3px">${ausTxt}</div></div>
        <div class="box"><div class="h">🆕 Neue Wache</div>
        ${b.voll} Leute einstellen: Mit aktiver Werbephase kommt höchstens <b>1 Person pro Nacht</b> → mindestens <b>${tage(b.voll)}</b> (frühestens ${datum(b.voll)}).
        ${b.aus.length ? `<br>Danach Lehrgänge: ca. <b>${maxD} Tage</b>, wenn alle parallel laufen → insgesamt ca. <b>${b.voll + maxD} Tage</b> (${datum(b.voll + maxD)}).` : ''}
        <div class="sub">Die Werbephase läuft max. 3 Tage und muss neu gestartet werden. Schneller geht's nur mit Coins (direkt einstellen).</div></div>`;
      // bestehende Wachen
      const passend = (geb || []).filter(g => b.wo.includes(g.bt));
      if (!passend.length) { html += '<div class="box sub">Du hast keine Wache, auf der diese Auswahl stehen kann.</div>'; erg.innerHTML = html; return; }
      const rows = passend.map(g => {
        const frei = g.p - g.voll, fehlt = Math.max(0, b.voll - frei);
        const mp = (pers || []).filter(x => x.w === g.id && !x.b);
        const fa = b.aus.map(x => { const hat = mp.filter(p => p.a.includes(x.l) || p.a.includes(x.cap)).length; return { ...x, hat, fehlt: Math.max(0, x.need - hat) }; });
        const faSum = fa.reduce((s, x) => s + x.fehlt, 0);
        return { g, frei, fehlt, fa, faSum, rang: (fehlt ? 2 : faSum ? 1 : 0) * 1e6 + fehlt * 1000 + faSum };
      }).sort((a, c) => a.rang - c.rang);
      html += `<div class="box"><div class="h">🏠 Deine Wachen${pers ? '' : ' <span class="sub">(Ausbildungen werden noch geladen …)</span>'}</div></div>` + rows.map(r => {
        const st = !r.fehlt && !r.faSum ? '<span class="ok">✅ passt sofort</span>'
          : !r.fehlt ? '<span class="mid">🟡 Personal reicht, Ausbildung fehlt</span>'
          : `<span class="bad">🔴 es fehlen ${r.fehlt} Leute → mind. ${tage(r.fehlt)}</span>`;
        const aus = r.fa.map(x => `<span class="tag" style="${x.fehlt ? 'color:#ff6b6b' : ''}">${esc(x.l)} ${x.hat}/${x.need}</span>`).join('');
        return `<div class="it"><button class="go" data-lat="${r.g.lat}" data-lng="${r.g.lng}" title="Wache auf Karte zentrieren">➤</button>
          <div class="main"><b>${esc(r.g.n)}</b> ${st}<div class="sub">frei: ${Math.max(0, r.frei)} von ${r.g.p} (${r.g.voll} schon für vorhandene Fahrzeuge verplant)</div>
          ${aus ? `<div>${aus} <span class="sub">freie ausgebildete Leute</span></div>` : ''}</div>
          <a href="#" data-open="/buildings/${r.g.id}">Details</a></div>`;
      }).join('');
      erg.innerHTML = html;
    }

    function ausbildungen() {
      const sel = pp.querySelector('.aus'), alt = sel.value, c = {};
      (pers || []).forEach(x => x.a.forEach(a => { c[a] = (c[a] || 0) + 1; }));
      sel.innerHTML = '<option value="">Alle Ausbildungen</option>' + Object.keys(c).sort((a, b) => a.localeCompare(b, 'de'))
        .map(a => `<option value="${esc(a)}">${esc(a)} (${c[a]})</option>`).join('');
      sel.value = alt;
    }

    async function personalLaden(erzwingen) {
      if (laden) return;
      const st = getJ('pers_t', 0);
      if (!erzwingen && st && Date.now() - st < CFG.personalCacheMin * 60000) { pers = getJ('pers', null); if (pers) { ausbildungen(); return zeichnen(); } }
      laden = true; pers = null; zeichnen();
      const info = pp.querySelector('.info');
      pers = await ladePersonal(geb, (i, n) => { info.textContent = `Lade Personal … Wache ${i} von ${n}`; });
      setJ('pers', pers); setJ('pers_t', Date.now());
      laden = false; ausbildungen(); zeichnen();
    }

    async function auf() {
      if (pp) { pp.remove(); pp = null; return; }
      addCss();
      pp = document.createElement('div'); pp.id = 'lssmz-pp'; pp.className = 'lssmz-fenster';
      pp.innerHTML = `<div class="hd"><span class="tab" data-t="p">👥 Personal</span><span class="tab" data-t="g">🏠 Gebäude</span>${AN('rechner') ? '<span class="tab" data-t="r">🧮 Rechner</span>' : ''}${kosten ? '<span class="tab" data-t="k">💰 Kosten</span>' : ''}<span class="x" title="Schließen">✕</span></div>
        <div class="tools"><input class="q" placeholder="Suchen: Name, Ausbildung, Wache, Fahrzeug …"><select class="aus"></select></div>
        <div class="info"></div><div class="list"></div>
        <div class="rech"><div class="tools"><input class="rq q2" placeholder="Fahrzeug suchen … (z.B. NEF, HLF 20, ELW 2)"></div><div class="treffer"></div><div class="auswahl"></div><div class="erg"></div></div>
        ${kosten ? '<div class="rech kosten"></div>' : ''}`;
      document.body.appendChild(pp);
      if (kosten) kosten.mount(pp.querySelector('.kosten'));
      pp.addEventListener('input', e => { if (e.target.classList.contains('q')) zeichnen(); if (e.target.classList.contains('rq')) treffer(); });
      pp.addEventListener('change', e => { if (e.target.classList.contains('aus')) zeichnen(); });
      pp.addEventListener('click', e => {
        const t = e.target.closest('[data-add],[data-inc],[data-dec],[data-rm],[data-t],[data-open],.go,.x,.reload,.nurwb') || e.target;
        if (t.dataset.add) { const f = auswahl.find(a => a.t === t.dataset.add); if (f) f.n++; else auswahl.push({ t: t.dataset.add, n: 1 }); pp.querySelector('.rq').value = ''; treffer(); return rechnerZeichnen(); }
        if (t.dataset.inc) { auswahl[+t.dataset.inc].n++; return rechnerZeichnen(); }
        if (t.dataset.dec) { const a = auswahl[+t.dataset.dec]; if (--a.n < 1) auswahl.splice(+t.dataset.dec, 1); return rechnerZeichnen(); }
        if (t.dataset.rm) { auswahl.splice(+t.dataset.rm, 1); return rechnerZeichnen(); }
        if (t.classList.contains('x')) { pp.remove(); pp = null; return; }
        if (t.dataset.t) { tab = t.dataset.t; return zeichnen(); }
        if (t.classList.contains('go')) { zentrieren(+t.dataset.lat, +t.dataset.lng); return; }
        if (t.dataset.open) { e.preventDefault(); oeffnen(t.dataset.open); return; }
        if (t.classList.contains('reload')) { e.preventDefault(); personalLaden(true); }
        if (t.classList.contains('nurwb')) { e.preventDefault(); nurWb = !nurWb; zeichnen(); }
      });
      pp.querySelector('.q').focus();
      zeichnen();
      { try { geb = await ladeGebaeude(); } catch (e) { pp.querySelector('.list').innerHTML = '<div class="it">Gebäude konnten nicht geladen werden.</div>'; return; } }
      zeichnen();
      personalLaden(false);
    }
    btn.addEventListener('click', () => auf());
    return {
      oeffne: async (t, wb) => { tab = t || tab; nurWb = !!wb; if (!pp) await auf(); else zeichnen(); },
    };
  }

  /* ------------------------------------------------------------------
   * 💰 KOSTENRECHNER (Reiter im Panel „👥 Personal & Wachen“)
   * ------------------------------------------------------------------ */
  const ausLabel = cap => (SCH[cap] ? SCH[cap].l : cap.replace(/[- ](Lehrgang|Ausbildung|Fortbildung|Schulung)$/i, ''));
  function fzAnf(id) {
    const t = FZT[id]; const max = t.maxPersonnel || 0, min = t.minPersonnel || 0, aus = [];
    if (t.schooling) {
      const dep = Object.values(t.schooling)[0] || {};
      for (const [cap, r] of Object.entries(dep)) {
        const need = r.all ? max : (r.min || 0);
        if (need > 0) aus.push({ cap, l: ausLabel(cap), need, d: SCH[cap] ? SCH[cap].d : 0 });
      }
    }
    return { max, min, aus };
  }
  // Reiter „💰 Kosten“ im Panel „👥 Personal & Wachen“. Der Zustand (Auswahl, Wache) bleibt erhalten, auch wenn das Panel zu ist.
  function kostenModul(holeGeb) {
    let kp = null, geb = null;
    const auswahl = [];   // [{t: Fahrzeugtyp-ID, n: Anzahl}]
    const anforderung = fzAnf;

    /* ---------- Kosten ---------- */
    // Preise kommen bevorzugt direkt vom Spiel-Server (dort ist eine laufende Rabattaktion schon eingerechnet).
    // Nur wenn der Server nichts liefert, wird der Listenpreis der LSS-Manager-Daten genommen.
    const wache = { bt: '', stufen: 0, ext: {} };   // geplante neue Wache
    const PREIS = { geb: null, fz: {}, geholt: {}, laedt: false };
    { const c = getJ('vpreis', null); if (c && Date.now() - c.t < CFG.preisCacheMin * 60000) { PREIS.fz = c.p || {}; (c.bts || []).forEach(b => { PREIS.geholt[b] = true; }); } }
    const zahlAus = x => parseInt(String(x == null ? '' : x).replace(/\D/g, ''), 10);
    const cr = n => (n || 0).toLocaleString('de-DE');
    const dom = t => new DOMParser().parseFromString(t, 'text/html');

    async function gebPreiseLaden() {
      if (PREIS.geb) return;
      const out = {};
      try {
        const d = dom(await fetch('/buildings/new').then(r => r.text()));
        d.querySelectorAll('[id^="detail_"]').forEach(el => {
          const bt = parseInt(el.id.slice(7), 10); if (isNaN(bt)) return;
          const werte = [...el.querySelectorAll('input[type="submit"],button')].map(b => b.value || b.textContent || '');
          const c = werte.find(w => /credits/i.test(w)), k = werte.find(w => /coins/i.test(w));
          const rb = el.querySelector('.building-discount-percent');
          out[bt] = {
            c: c ? zahlAus(c) : null, k: k ? zahlAus(k) : null,
            rabatt: rb ? (zahlAus(rb.textContent) || 0) : 0,
            start: [...el.querySelectorAll('select[name^="building[start_vehicle"] option')].map(o => o.value).filter(v => v !== ''),
          };
        });
      } catch (e) {}
      PREIS.geb = out;
    }
    // Fahrzeugpreise einer Gebäudeart von der Kaufseite einer eigenen Wache dieser Art lesen
    async function fzPreiseLaden(bt) {
      if (PREIS.geholt[bt]) return;
      PREIS.geholt[bt] = true;
      const g = (geb || []).find(x => x.bt === bt); if (!g) return;
      try {
        const d = dom(await fetch(`/buildings/${g.id}/vehicles/new`).then(r => r.text()));
        d.querySelectorAll('section.purchase[data-credits-unit]').forEach(sec => {
          const box = sec.closest('.vehicle_type') || sec.parentElement;
          const a = box && box.querySelector('a[href*="/credits"],a[href*="/coins"]');
          const m = a && a.getAttribute('href').match(/\/vehicle\/\d+\/(\d+)\/(credits|coins)/);
          if (m) PREIS.fz[m[1]] = { c: zahlAus(sec.dataset.creditsUnit) || 0, k: zahlAus(sec.dataset.coinsUnit) || 0 };
        });
      } catch (e) { PREIS.geholt[bt] = false; return; }
      setJ('vpreis', { t: Date.now(), p: PREIS.fz, bts: Object.keys(PREIS.geholt).filter(b => PREIS.geholt[b]).map(Number) });
    }
    // Auf welcher eigenen Gebäudeart kann man das Fahrzeug kaufen (geplante Wache bevorzugt)?
    function fzBt(id) {
      const wo = (FZT[id] && FZT[id].possibleBuildings) || [], hab = new Set((geb || []).map(g => g.bt));
      if (wache.bt !== '' && wo.includes(+wache.bt) && hab.has(+wache.bt)) return +wache.bt;
      return wo.find(b => hab.has(b));
    }
    async function preiseNachladen() {
      if (!FZT || PREIS.laedt) return;
      const bts = new Set(auswahl.map(a => fzBt(a.t)).filter(b => b != null && !PREIS.geholt[b]));
      if (!bts.size && PREIS.geb) return;
      PREIS.laedt = true; if (kp) zeichnen();
      await gebPreiseLaden();
      for (const b of bts) await fzPreiseLaden(b);
      PREIS.laedt = false; if (kp) zeichnen();
    }
    function fzPreis(id) {
      const t = FZT[id], liste = { c: t.credits || 0, k: t.coins || 0 }, sv = PREIS.fz[id];
      if (!sv) return { ...liste, liste: true, rabatt: 0 };
      const rabatt = liste.c && sv.c && sv.c < liste.c ? Math.round((1 - sv.c / liste.c) * 100) : 0;
      return { c: sv.c, k: sv.k, liste: false, rabatt };
    }
    const lbW = () => (wache.bt !== '' && LB && LB[wache.bt]) || null;
    // Erweiterung der geplanten Wache, die das Fahrzeug freischaltet (z.B. RTW auf Feuerwache → „Rettungsdienst“)
    function noetigeErw(id) {
      const w = lbW(); if (!w) return -1;
      return (w.extensions || []).findIndex(e => (e.unlocksVehicleTypes || []).includes(+id));
    }
    const passtAufWache = id => !lbW() || ((FZT[id].possibleBuildings || []).includes(+wache.bt));
    // Hinweise je Fahrzeug: Ausbildung, Sonderregeln, passt nicht auf die Wache, Erweiterung nötig
    function hinweise(id) {
      const t = FZT[id], r = anforderung(id), out = [];
      if (r.aus.length) out.push(`<div class="warn">⚠️ Braucht Personal mit Ausbildung: ${r.aus.map(x => `<b>${esc(x.l)}</b> ×${x.need}${x.d ? ` (${x.d} Tage Lehrgang)` : ''}`).join(', ')}</div>`);
      if (t.special) out.push(`<div class="sub">ℹ️ ${esc(t.special)}</div>`);
      const w = lbW();
      if (w && !passtAufWache(id)) out.push(`<div class="bad">🚫 Kann nicht auf „${esc(w.caption)}“ stehen</div>`);
      else if (w) { const e = noetigeErw(id); if (e >= 0) out.push(`<div class="mid">🧩 Braucht die Erweiterung „${esc(w.extensions[e].caption)}“ (in den Kosten enthalten)</div>`); }
      return out.join('');
    }
    function wacheZeichnen() {
      const box = kp.querySelector('.wbox');
      if (!LB) { box.innerHTML = '<div class="box sub">Gebäudedaten (LSS-Manager) nicht erreichbar – Kosten nur für Fahrzeuge.</div>'; return; }
      const typen = Object.entries(LB).filter(([, b]) => (b.credits || 0) > 0).sort(([, a], [, b]) => a.caption.localeCompare(b.caption, 'de'));
      const w = lbW(), lv = w && w.levelPrices && w.levelPrices.credits ? w.levelPrices.credits.length : 0;
      box.innerHTML = `<div class="box"><div class="h">🏗️ Neue Wache bauen? <span class="sub">(optional)</span></div>
        <select class="wsel"><option value="">– keine, nur Fahrzeuge –</option>${typen.map(([i, b]) => `<option value="${i}" ${String(wache.bt) === i ? 'selected' : ''}>${esc(b.caption)}</option>`).join('')}</select>
        ${w && lv ? `<label style="margin-left:8px">Ausbaustufen <input type="number" class="wst" min="0" max="${lv}" value="${wache.stufen}" style="width:55px"> <span class="sub">(max. ${lv})</span></label>` : ''}
        ${w && (w.extensions || []).length ? `<div style="margin-top:4px">${w.extensions.map((e, i) => `<label><input type="checkbox" class="wext" data-i="${i}" ${wache.ext[i] ? 'checked' : ''}> ${esc(e.caption)} <span class="sub">${cr(e.credits)} Cr</span></label>`).join('')}</div>` : ''}</div>`;
    }
    function kostenHtml() {
      const z = []; let sc = 0, sk = 0, kFehlt = false, liste = false;
      const zeile = (txt, c, k, extra) => {
        z.push(`<tr><td>${txt}${extra || ''}</td><td class="r">${c == null ? '–' : cr(c) + ' Cr'}</td><td class="r">${k == null || k < 0 ? '–' : cr(k) + ' Co'}</td></tr>`);
        sc += c || 0; if (k == null || k < 0) kFehlt = true; else sk += k;
      };
      const rbTag = p => p ? `<span class="rb" title="Rabattaktion vom Server">−${p} %</span>` : '';
      const lt = () => { liste = true; return ' <span class="sub">(Listenpreis)</span>'; };
      const w = lbW();
      let frei = null;   // Startfahrzeug, das beim Bau dabei ist
      if (w) {
        const gp = PREIS.geb && PREIS.geb[wache.bt];
        if (gp && gp.c != null) zeile(`🏠 ${esc(w.caption)} bauen`, gp.c, gp.k, rbTag(gp.rabatt));
        else zeile(`🏠 ${esc(w.caption)} bauen`, w.credits, w.coins, lt());
        if (wache.stufen > 0 && w.levelPrices) {
          const s = (w.levelPrices.credits || []).slice(0, wache.stufen).reduce((a, b) => a + b, 0);
          const k = (w.levelPrices.coins || []).slice(0, wache.stufen).reduce((a, b) => a + b, 0);
          zeile(`⬆️ Ausbaustufe 1–${wache.stufen}`, s, k, lt());
        }
        const grund = {};
        auswahl.forEach(a => { const e = noetigeErw(a.t); if (e >= 0) (grund[e] = grund[e] || []).push(FZT[a.t].caption); });
        (w.extensions || []).forEach((e, i) => {
          if (!wache.ext[i] && !grund[i]) return;
          zeile(`🧩 Erweiterung „${esc(e.caption)}“${grund[i] ? ` <span class="sub">– nötig für ${esc(grund[i].join(', '))}</span>` : ''}`, e.credits, e.coins, lt());
        });
        // Startfahrzeug: das teuerste passende aus der Auswahl ist beim Bau gratis
        const start = (gp && gp.start) || [];
        auswahl.filter(a => start.includes(String(a.t))).forEach(a => { if (!frei || fzPreis(a.t).c > fzPreis(frei).c) frei = a.t; });
      }
      auswahl.forEach(a => {
        const p = fzPreis(a.t), n = a.n - (frei === a.t ? 1 : 0);
        const txt = `🚒 ${a.n}× ${esc(FZT[a.t].caption)} <span class="sub">à ${cr(p.c)} Cr${frei === a.t ? ', 1× Startfahrzeug gratis' : ''}</span>`;
        zeile(txt, p.c * n, p.k * n, p.liste ? lt() : rbTag(p.rabatt));
      });
      if (!z.length) return '';
      return `<div class="box"><div class="h">💰 Kosten${PREIS.laedt ? ' <span class="sub">(Preise werden geladen …)</span>' : ''}</div>
        <table class="kost">${z.join('')}<tr class="sum"><td>Gesamt</td><td class="r">${cr(sc)} Cr</td><td class="r">${kFehlt ? '–' : cr(sk) + ' Co'}</td></tr></table>
        <div class="sub" style="margin-top:4px">Preise ohne Zusatz kommen direkt vom Spiel – eine laufende Rabattaktion ist dort schon drin (<span class="rb">−%</span> = Rabatt).
        ${liste ? '„Listenpreis“ = Normalpreis aus den LSS-Manager-Daten, ein Rabatt ist da nicht berücksichtigt.' : ''} Credits <i>oder</i> Coins – die Coins-Spalte ist nur zum Vergleich.</div></div>`;
    }

    function treffer() {
      const box = kp.querySelector('.treffer'), q = kp.querySelector('.kq').value.trim().toLowerCase();
      if (!FZT) { box.innerHTML = '<div class="it sub">Fahrzeugdaten (LSS-Manager) nicht erreichbar.</div>'; return; }
      if (!q) { box.innerHTML = ''; return; }
      const hits = Object.entries(FZT).filter(([, t]) => t.caption.toLowerCase().includes(q))
        .sort(([, a], [, b]) => (b.caption.toLowerCase().startsWith(q) - a.caption.toLowerCase().startsWith(q)) || a.caption.localeCompare(b.caption, 'de', { numeric: true })).slice(0, 10);
      box.innerHTML = hits.length ? hits.map(([id, t]) => { const r = anforderung(id), p = fzPreis(id); return `<div class="it pick" data-add="${id}">
        <div class="main"><b>${esc(t.caption)}</b>${r.aus.length ? ' <span class="warn" title="Braucht Personal mit Ausbildung">⚠️</span>' : ''}${passtAufWache(id) ? '' : ' <span class="bad" title="Passt nicht auf die geplante Wache">🚫</span>'}
        <div class="sub">${cr(p.c)} Credits${p.rabatt ? ` <span class="rb">−${p.rabatt} %</span>` : ''} · ${cr(p.k)} Coins${r.aus.length ? ' · ' + r.aus.map(x => `${esc(x.l)} ×${x.need}`).join(', ') : ''}</div></div>
        <button class="go" data-add="${id}">＋</button></div>`; }).join('') : '<div class="it sub">Kein Fahrzeug gefunden.</div>';
    }
    function zeichnen() {
      if (!kp) return;
      const aw = kp.querySelector('.auswahl'), erg = kp.querySelector('.erg');
      if (!geb) { erg.innerHTML = '<div class="box">Lade Daten …</div>'; return; }
      aw.innerHTML = auswahl.length ? '<div class="box"><div class="h">Fahrzeuge</div>' + auswahl.map((a, i) => `<div class="it">
        <div class="main"><b>${a.n}× ${esc(FZT[a.t].caption)}</b>${hinweise(a.t)}</div>
        <button class="sb" data-dec="${i}">−</button><button class="sb" data-inc="${i}">＋</button><button class="sb" data-rm="${i}">✕</button></div>`).join('') + '</div>' : '';
      const k = kostenHtml();
      erg.innerHTML = k || '<div class="box sub">Wähl oben eine Wache und/oder such Fahrzeuge und klick sie an – dann siehst du hier, was alles zusammen kostet (mit laufender Rabattaktion).</div>';
    }
    function mount(box) {
      kp = box;
      kp.innerHTML = `<div class="wbox"></div><div class="tools"><input class="kq" placeholder="Fahrzeug suchen … (z.B. HLF 20, FwK, RTW)"></div><div class="treffer"></div><div class="auswahl"></div><div class="erg"></div>`;
      kp.addEventListener('input', e => { e.stopPropagation(); if (e.target.classList.contains('kq')) treffer(); });
      kp.addEventListener('change', e => {
        e.stopPropagation();
        const c = e.target.classList;
        if (c.contains('wsel')) { wache.bt = e.target.value; wache.stufen = 0; wache.ext = {}; wacheZeichnen(); treffer(); zeichnen(); preiseNachladen(); }
        if (c.contains('wst')) { const lv = ((lbW() || {}).levelPrices || {}).credits || []; wache.stufen = Math.max(0, Math.min(lv.length, parseInt(e.target.value, 10) || 0)); e.target.value = wache.stufen; zeichnen(); }
        if (c.contains('wext')) { wache.ext[e.target.dataset.i] = e.target.checked; zeichnen(); }
      });
      kp.addEventListener('click', e => {
        e.stopPropagation();   // nicht an den Rechner-Reiter weiterreichen (gleiche data-Attribute)
        const t = e.target.closest('[data-add],[data-inc],[data-dec],[data-rm]') || e.target;
        if (t.dataset.add) { const f = auswahl.find(a => a.t === t.dataset.add); if (f) f.n++; else auswahl.push({ t: t.dataset.add, n: 1 }); kp.querySelector('.kq').value = ''; treffer(); zeichnen(); return preiseNachladen(); }
        if (t.dataset.inc) { auswahl[+t.dataset.inc].n++; return zeichnen(); }
        if (t.dataset.dec) { const a = auswahl[+t.dataset.dec]; if (--a.n < 1) auswahl.splice(+t.dataset.dec, 1); return zeichnen(); }
        if (t.dataset.rm) { auswahl.splice(+t.dataset.rm, 1); return zeichnen(); }
      });
    }
    function zeigen() {
      geb = holeGeb();
      if (!kp) return;
      if (geb && !kp.querySelector('.wsel')) wacheZeichnen();
      zeichnen();
      if (geb) preiseNachladen();
    }
    return { mount, zeigen };
  }

  /* ------------------------------------------------------------------
   * ⚙️ EINSTELLUNGSFENSTER
   * ------------------------------------------------------------------ */
  const FUNK_TEXT = {
    massnahmen: 'Zusatzaufgaben im Einsatzfenster',
    abzeichen: 'Farbige Abzeichen in der Einsatzliste',
    meldungen: 'Meldungen unten rechts',
    statistik: 'Zähler unten links',
    personalPanel: 'Button „👥 Personal & Wachen“',
    rechner: 'Reiter „🧮 Rechner“ im Panel',
    kostenrechner: 'Reiter „💰 Kosten“ im Panel (Kostenrechner)',
    werbeWarnung: 'Werbephasen-Warnung',
    aaoProtokoll: 'AAO-Protokoll (alte Werte merken)',
    verletzte: 'Einsatzliste: Verletzte 🩹 / ❔ / ⚪ mit Filter',
    aaoFehlt: 'AAO: 🚫 bei Fahrzeugen, die du nicht hast',
  };
  function einstellungen() {
    if (document.getElementById('lssmz-set')) return;
    addCss();
    const ov = document.createElement('div'); ov.id = 'lssmz-set';
    const an = k => AN(k) ? 'checked' : '';
    const zahl = (k, faktor, min, max, step) => `<input type="number" data-cfg="${k}" data-f="${faktor}" min="${min}" max="${max}" step="${step}" value="${+(CFG[k] / faktor).toFixed(2)}">`;
    ov.innerHTML = `<div class="box"><h3>⚙️ LSS Leitstellen-Maßnahmen – Einstellungen</h3>
      <h4>Funktionen</h4>${Object.keys(FUNK_TEXT).map(k => `<label><input type="checkbox" data-fn="${k}" ${an(k)}> ${FUNK_TEXT[k]}</label>`).join('')}
      <h4>Anzeige & Spiel</h4>
      <div class="zeile">Größe (1 = normal, 1.3 = 130 %) ${zahl('zoom', 1, 0.7, 2.5, 0.1)}</div>
      <div class="zeile">Rückmeldung frühestens nach (Minuten) ${zahl('rueckmeldungMin', 60, 0.5, 60, 0.5)}</div>
      <div class="zeile">Rückmeldung spätestens nach (Minuten) ${zahl('rueckmeldungMax', 60, 0.5, 120, 0.5)}</div>
      <div class="zeile">Chance „besetzt“ beim Anruf (%) ${zahl('besetztChance', 0.01, 0, 90, 1)}</div>
      <div class="zeile">Werbephasen-Warnung wiederholen alle (Minuten) ${zahl('werbeWarnAlleMin', 1, 5, 1440, 5)}</div>
      <div class="zeile">AAO-Protokoll: angezeigte Einträge ${zahl('aaoAnzeige', 1, 1, 20, 1)}</div>
      <div class="zeile">Kostenrechner: Preise zwischenspeichern (Minuten) ${zahl('preisCacheMin', 1, 1, 240, 1)}</div>
      <div class="knoepfe"><button class="btn btn-default btn-sm" data-a="std">Auf Standard zurücksetzen</button>
      <button class="btn btn-default btn-sm" data-a="x">Abbrechen</button>
      <button class="btn btn-success btn-sm" data-a="ok">Speichern & neu laden</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => {
      if (e.target === ov) return ov.remove();
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'x') return ov.remove();
      if (a === 'std') { if (confirm('Alle Einstellungen auf Standard zurücksetzen?')) { localStorage.removeItem('lssmz_einst'); location.reload(); } return; }
      const fn = {}, cfg = {};
      ov.querySelectorAll('[data-fn]').forEach(i => { fn[i.dataset.fn] = i.checked ? 'ja' : 'nein'; });
      ov.querySelectorAll('[data-cfg]').forEach(i => { const v = parseFloat(String(i.value).replace(',', '.')); if (!isNaN(v)) cfg[i.dataset.cfg] = Math.round(v * parseFloat(i.dataset.f) * 1000) / 1000; });
      if (cfg.rueckmeldungMax < cfg.rueckmeldungMin) cfg.rueckmeldungMax = cfg.rueckmeldungMin;
      localStorage.setItem('lssmz_einst', JSON.stringify({ funktionen: fn, cfg }));
      location.reload();
    });
  }
  function einstellButton() {
    if (document.getElementById('lssmz-setbtn')) return;
    const nach = document.getElementById('lssmz-ppbtn') || document.getElementById('map_adress_search_form');
    if (!nach) return;
    const b = document.createElement('button');
    b.id = 'lssmz-setbtn'; b.type = 'button'; b.className = 'btn btn-default btn-sm'; b.title = 'Einstellungen LSS Leitstellen-Maßnahmen';
    b.textContent = '⚙️';
    b.addEventListener('click', einstellungen);
    nach.insertAdjacentElement('afterend', b);
  }

  /* ------------------------------------------------------------------
   * 🩹 VERLETZTE: Einsatzarten einteilen + Filter
   * ------------------------------------------------------------------ */
  const V_TEXT = { g: ['🩹', 'garantiert Verletzte'], m: ['❔', 'möglicherweise Verletzte'], k: ['⚪', 'keine Verletzten'] };
  async function einsatzarten() {
    try { const c = JSON.parse(sessionStorage.getItem('lssmz_einsatzarten')); if (c && Date.now() - c.t < 60 * 60000) return c.v; } catch (e) {}
    const m = await fetch('/einsaetze.json').then(r => r.json());
    const v = {};
    m.forEach(x => { const a = x.additional || {}; v[x.id] = (a.possible_patient_min || 0) > 0 ? 'g' : (a.possible_patient || 0) > 0 ? 'm' : 'k'; });
    try { sessionStorage.setItem('lssmz_einsatzarten', JSON.stringify({ t: Date.now(), v })); } catch (e) {}
    return v;
  }
  async function verletzte() {
    let arten;
    try { arten = await einsatzarten(); } catch (e) { return; }
    addCss();
    const aus = new Set(getJ('vfilter', []));
    const setzeKlassen = () => ['g', 'm', 'k'].forEach(c => document.body.classList.toggle(`lssmz-v-${c}-aus`, aus.has(c)));
    setzeKlassen();
    const ziel = document.getElementById('mission-filters-block') || document.getElementById('missions-panel-body');
    if (ziel && !document.getElementById('lssmz-vfilter')) {
      const bar = document.createElement('div'); bar.id = 'lssmz-vfilter';
      const male = () => { bar.innerHTML = '<span>Verletzte:</span>' + ['g', 'm', 'k'].map(c => `<button type="button" class="btn btn-xs btn-default ${aus.has(c) ? 'aus' : ''}" data-v="${c}" title="${V_TEXT[c][1]} ein-/ausblenden">${V_TEXT[c][0]} ${V_TEXT[c][1]}</button>`).join(''); };
      male();
      bar.addEventListener('click', e => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        const c = b.dataset.v; aus.has(c) ? aus.delete(c) : aus.add(c);
        setJ('vfilter', [...aus]); setzeKlassen(); male();
      });
      ziel.insertAdjacentElement(ziel.id === 'mission-filters-block' ? 'afterend' : 'afterbegin', bar);
    }
    const markiere = () => {
      document.querySelectorAll('.missionSideBarEntry').forEach(el => {
        const typ = parseInt(el.getAttribute('mission_type_id'), 10);
        const c = arten[typ]; if (!c) return;
        if (el.dataset.lssmzV !== c) el.dataset.lssmzV = c;
        const id = el.getAttribute('mission_id');
        const cap = document.getElementById('mission_caption_' + id);
        if (cap && !(cap.previousElementSibling && cap.previousElementSibling.classList.contains('lssmz-v'))) {
          const sp = document.createElement('span'); sp.className = 'lssmz-v'; sp.textContent = V_TEXT[c][0]; sp.title = V_TEXT[c][1];
          cap.insertAdjacentElement('beforebegin', sp);
        }
      });
    };
    markiere();
    setInterval(markiere, 3000);
  }

  /* ------------------------------------------------------------------
   * 🚫 AAO: Fahrzeug gar nicht vorhanden
   * ------------------------------------------------------------------ */
  const FZ_META = /^(value|class|id|name|type|fms|building_id|tractive_|trailer_vehicle_id|at_staging_area|autocomplete|ignore_aao|vehicle_type_ignore_default_aao|custom_|vehicle_type_id|possible_tractive|data-|checked|style)/;
  const AAO_META = /^(search_attribute|title|accesskey|href|style|class|id|aao_id|reset|building_ids|equipment_mode|custom|data-)/;
  async function aaoFehlt() {
    // Merkmale pro Fahrzeugtyp aus den Fahrzeugen im Fenster lernen und dauerhaft merken
    const caps = getJ('caps', {});
    document.querySelectorAll('input.vehicle_checkbox').forEach(cb => {
      const t = cb.getAttribute('vehicle_type_id'); if (!t) return;
      const set = new Set(caps[t] || []);
      [...cb.attributes].forEach(a => { if (!FZ_META.test(a.name) && parseFloat(a.value) > 0) set.add(a.name); });
      caps[t] = [...set];
    });
    setJ('caps', caps);
    let fz;
    // eigener Cache-Name: fremde Scripte legen unter „aVehicles“ teils unvollständige Listen ab
    try { fz = await api('lssmz_fz', '/api/vehicles'); } catch (e) { return; }
    if (!Array.isArray(fz) || !fz.length) return;
    const typen = [...new Set(fz.map(v => String(v.vehicle_type)))];
    if (typen.some(t => !caps[t])) return; // noch nicht alle eigenen Typen bekannt → lieber nichts falsch markieren
    const habe = new Set(); typen.forEach(t => caps[t].forEach(c => habe.add(c)));
    // was gerade frei im Fenster steht, hast du auf jeden Fall
    document.querySelectorAll('input.vehicle_checkbox').forEach(cb => (caps[cb.getAttribute('vehicle_type_id')] || []).forEach(c => habe.add(c)));
    const hat = atom => habe.has(atom) || habe.has(atom + '_only') || habe.has('only_' + atom) || habe.has(atom.replace(/_only$/, ''));
    const erfuellbar = feld => feld.split('_or_').some(alt => alt.split('_and_').every(hat)) || hat(feld);
    document.querySelectorAll('a.aao_btn[aao_id]').forEach(a => {
      const fehlt = [...a.attributes].some(x => !AAO_META.test(x.name) && parseFloat(x.value) > 0 && !erfuellbar(x.name));
      if (!fehlt) return;
      a.classList.add('lssmz-fehlt');
      a.title = (a.getAttribute('search_attribute') || '') + ' – 🚫 Fahrzeug nicht vorhanden';
      if (!a.querySelector('.lssmz-no')) { const sp = document.createElement('span'); sp.className = 'lssmz-no'; sp.textContent = '🚫 '; a.insertAdjacentElement('afterbegin', sp); }
    });
    // Sicherheitsnetz: meldet das Spiel den Button als verfügbar (grüner Haken), kommt das 🚫 wieder weg
    const pruefe = () => document.querySelectorAll('a.aao_btn.lssmz-fehlt').forEach(a => {
      const l = document.getElementById('available_aao_' + a.getAttribute('aao_id'));
      if (!l || !(l.classList.contains('label-success') || /✔|✓/.test(l.textContent))) return;
      a.classList.remove('lssmz-fehlt'); a.title = a.getAttribute('search_attribute') || '';
      a.querySelectorAll('.lssmz-no').forEach(x => x.remove());
    });
    pruefe(); [500, 1500, 4000].forEach(ms => setTimeout(pruefe, ms));
    const box = document.querySelector('a.aao_btn[aao_id]');
    const wurzel = box && (box.closest('#mission-aao-group, .tab-content, form') || document.body);
    if (wurzel) new MutationObserver(pruefe).observe(wurzel, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  }

  /* ------------------------------------------------------------------
   * AAO-PROTOKOLL: alte Werte merken und wieder eintragen
   * ------------------------------------------------------------------ */
  function aaoFelder(form) {
    const out = {};
    form.querySelectorAll('[name^="aao["]').forEach(el => {
      if (el.type === 'hidden' || el.type === 'submit') return;
      let v;
      if (el.type === 'checkbox') v = el.checked ? '1' : '0';
      else if (el.multiple) v = [...el.selectedOptions].map(o => o.value).join(',');
      else v = el.value;
      out[el.name] = v;
    });
    return out;
  }
  function aaoLabel(form, name) {
    const el = form.querySelector(`[name="${name}"]:not([type=hidden])`);
    const l = el && el.id && form.querySelector(`label[for="${el.id}"]`);
    return l ? l.textContent.replace(/^\*\s*/, '').trim() : name.replace(/^aao\[/, '').replace(/\](\[\])?$/, '');
  }
  function aaoSetzen(form, werte) {
    for (const [name, v] of Object.entries(werte)) {
      const el = form.querySelector(`[name="${name}"]:not([type=hidden])`); if (!el) continue;
      if (el.type === 'checkbox') el.checked = v === '1';
      else if (el.multiple) { const set = new Set(String(v).split(',')); [...el.options].forEach(o => { o.selected = set.has(o.value); }); }
      else el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.style.outline = '2px solid #c9a227';
    }
  }

  function aaoEdit(id) {
    const form = document.querySelector(`form[action="/aaos/${id}"]`); if (!form) return;
    addCss();
    const start = aaoFelder(form);
    form.addEventListener('submit', () => {
      const neu = aaoFelder(form), alt = {}, jetzt = {};
      for (const k of Object.keys(neu)) if (neu[k] !== start[k]) { alt[k] = start[k]; jetzt[k] = neu[k]; }
      if (!Object.keys(alt).length) return;
      const h = getJ('aao', []);
      h.push({ id, n: neu['aao[caption]'] || start['aao[caption]'] || '', t: Date.now(), alt, neu: jetzt });
      setJ('aao', h.slice(-100));
    });
    const eintraege = getJ('aao', []).filter(x => x.id === id).reverse();
    if (!eintraege.length) return;
    const box = document.createElement('div');
    box.className = 'lssmz-panel';
    box.innerHTML = `<h4><span>🕘 Frühere Stände dieser AAO</span><span>${eintraege.length}</span></h4>` + eintraege.slice(0, CFG.aaoAnzeige).map((x, i) => {
      const keys = Object.keys(x.alt);
      const liste = keys.slice(0, 8).map(k => `${esc(aaoLabel(form, k))}: <b>${esc(x.alt[k])}</b> → ${esc(x.neu[k])}`).join(' · ') + (keys.length > 8 ? ` · … +${keys.length - 8}` : '');
      return `<div class="lssmz-row"><div class="txt"><b>${new Date(x.t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</b><div class="ans">${liste}</div></div>
        <button class="btn btn-xs btn-warning" data-aao="${i}" title="Trägt die alten Werte ins Formular ein – speichern musst du selbst">↶ Alte Werte eintragen</button></div>`;
    }).join('');
    form.insertAdjacentElement('beforebegin', box);
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-aao]'); if (!b) return;
      e.preventDefault();
      aaoSetzen(form, eintraege[+b.dataset.aao].alt);
      b.textContent = '✔ Eingetragen – jetzt unten speichern';
      b.className = 'btn btn-xs btn-success';
    });
  }

  function aaoListe() {
    const h = getJ('aao', []); if (!h.length) return;
    const ziel = document.querySelector('#iframe-inside-container, .container-fluid, body'); if (!ziel) return;
    addCss();
    const box = document.createElement('div');
    box.className = 'lssmz-panel';
    box.innerHTML = `<h4><span>🕘 Zuletzt geänderte AAOs</span><span>${h.length}</span></h4>` + h.slice(-CFG.aaoAnzeige).reverse().map(x =>
      `<div class="lssmz-row"><div class="txt"><b>${esc(x.n)}</b> <span class="ans">${new Date(x.t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${Object.keys(x.alt).length} Feld(er) geändert</span></div>
      <a class="btn btn-xs btn-default" href="/aaos/${x.id}/edit">Öffnen</a></div>`).join('');
    ziel.insertAdjacentElement('afterbegin', box);
  }

  const mm = location.pathname.match(/^\/missions\/(\d+)/);
  const ma = location.pathname.match(/^\/aaos\/(\d+)\/edit/);
  if (mm) { if (AN('massnahmen')) missionWindow(mm[1]); if (AN('aaoFehlt')) aaoFehlt().catch(() => {}); }
  else if (ma) { if (AN('aaoProtokoll')) aaoEdit(ma[1]); }
  else if (location.pathname === '/aaos') { if (AN('aaoProtokoll')) aaoListe(); }
  else if (location.pathname === '/') mainPage();
})();
