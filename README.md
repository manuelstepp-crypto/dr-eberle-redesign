# 🍲 KPT – Kulinarisches Projektteam

Web-App für unseren Kochclub (~15 Personen, Treffen jeden Freitag). Sie digitalisiert
Organisation, Dokumentation und das soziale Miteinander rund um die Koch-Abende.

**Mobile-First** · läuft als statische Web-App (GitHub Pages) mit **Supabase** als Backend
(geteilte Daten für alle Mitglieder, Foto-Speicher).

## Features

| Bereich | Funktionen |
|---|---|
| 📅 **Termine** | Übersicht aller Freitags-Termine, selbst als **Chefkoch eintragen/austragen**, neue Termine anlegen |
| 🍽️ **An-/Abmeldung** | Pro Termin zu- oder absagen – der Koch sieht live, für wie viele er kochen muss |
| 🍲 **Rezepte** | Durchsuchbares Archiv aller Menüs mit Zutaten & Zubereitung |
| 📸 **Galerie** | Fotos pro Abend direkt vom Smartphone hochladen |
| ⭐ **Bewertung** | 5-Sterne-Voting nach dem Essen (eine Stimme pro Person & Termin) |
| 🏆 **Ranking** | Bestes Gericht aller Zeiten + Top-Liste |
| 📊 **Statistik** | Koch-Counter pro Jahr & Fairness-Check „wer wäre mal wieder dran?" |
| 💬 **Chat** | Globaler Gruppenchat |
| 👤 **Profil** | Profilbild setzen, eigene Statistik, Benutzer wechseln |

## Technik

- **Frontend:** Vanilla HTML/CSS/JS (kein Build-Step), Supabase-JS via CDN → direkt auf GitHub Pages deploybar.
- **Backend:** Supabase (PostgreSQL + Storage). Projekt-Konfiguration in `config.js`.
- **Login:** Einfache Namensauswahl (bewusst niedrigschwellig). Die Auswahl wird pro Gerät im `localStorage` gemerkt.

### Datenmodell

`members` · `termine` (mit `koch_id`) · `gerichte` · `bilder` · `bewertungen` · `anmeldungen` · `chat_messages`

### Sicherheitshinweis

Da kein echter Login genutzt wird, läuft die App mit dem öffentlichen Supabase
*Publishable Key* und **offenen RLS-Policies** (anon darf lesen/schreiben). Das ist für
einen kleinen, privaten Club ein bewusster Kompromiss zugunsten der Einfachheit.
Wer höhere Sicherheit braucht, kann später auf echtes Supabase-Auth (Magic-Link) umstellen
und die Policies an `auth.uid()` binden.

## Lokal starten

```bash
npx serve .
# oder
python3 -m http.server 8080
```

Dann im Browser öffnen. Es wird kein Build benötigt.
