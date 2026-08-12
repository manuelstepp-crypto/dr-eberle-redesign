# Sketch-Agent — Live-Sketchnotes aus gesprochener Sprache

Sprich ins Mikrofon, und ein Agent zeichnet live eine Sketchnote mit: Streaming-Spracherkennung (Deepgram) liefert ein Rolling Transcript, ein Sketch-Agent (Anthropic API) entscheidet alle paar Sekunden, was auf einer animierten SVG-Canvas ergänzt wird — Icons, Textnotizen, Pfeile.

## Architektur

```
Mikrofon ─► AudioWorklet (Int16-PCM) ─► WebSocket /listen ─► Node-Server ─► Deepgram Streaming-STT
                                                                  │
Browser ◄── Transkript-Events (interim + final) ◄─────────────────┘
   │
   ├── Rolling Transcript + Debounce-Logik
   │       (Sprechpause ODER Max-Intervall, min. 60 neue Zeichen, nie parallel)
   │
   └── POST /api/sketch ─► Node-Server ─► Anthropic API (structured outputs)
              │                              System-Prompt mit Icon-Bibliothek + Prompt-Caching
              ▼
        SVG-Canvas: Icons/Texte/Pfeile mit Zeichen-Animation (stroke-dashoffset)
```

Beide API-Keys bleiben auf dem Server — der Browser spricht nur mit dem eigenen Node-Server.

## Setup

Voraussetzungen: Node.js ≥ 18, ein [Deepgram-Key](https://console.deepgram.com/) (Startguthaben reicht für viele Teststunden) und ein [Anthropic-Key](https://platform.claude.com/).

```bash
cd sketch-agent
npm install
cp .env.example .env    # Keys eintragen
npm start
```

Dann http://localhost:3000 öffnen, **Start** drücken, Mikrofonzugriff erlauben, sprechen.

> **Mikrofon & HTTPS:** Browser geben `getUserMedia` nur auf `localhost` oder über HTTPS frei. Lokal funktioniert es direkt; auf einem Server (z. B. Hetzner) brauchst du einen Reverse-Proxy mit TLS (siehe unten).

## Konfiguration (.env)

| Variable | Default | Bedeutung |
|---|---|---|
| `DEEPGRAM_API_KEY` | — | Pflicht: Streaming-STT |
| `ANTHROPIC_API_KEY` | — | Pflicht: Sketch-Agent |
| `PORT` | `3000` | HTTP-Port |
| `DEEPGRAM_MODEL` | `nova-2` | Deepgram-Modell |
| `DEEPGRAM_LANGUAGE` | `de` | Sprache der Erkennung |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Modell für den Agent-Loop |
| `SKETCH_EFFORT` | `low` | Reasoning-Aufwand pro Aufruf (`low` = schnell & günstig, für den Loop ideal) |

## Debounce-Regeln (app.js, oben als Konstanten)

- `MIN_INTERVAL_MS` (6 s): frühestens so oft wird der Agent gefragt
- `MAX_INTERVAL_MS` (18 s): spätestens dann, wenn ohne Pause weitergesprochen wird
- `MIN_NEW_CHARS` (60): so viel finalisierter neuer Text muss vorliegen
- Auslöser ist bevorzugt eine Sprechpause (Deepgram `speech_final` / `UtteranceEnd`)
- Nie zwei Agent-Aufrufe parallel; beim Stoppen ein letzter Aufruf mit dem Rest

Diese Werte sind bewusst Konstanten im Code — genau dafür da, sie mit echtem Sprechen zu tunen.

## Wie der Agent entscheidet

Der Server schickt pro Aufruf: die Liste der bereits gezeichneten Elemente (IDs, Positionen), das Transkript-Fenster (letzte ~1600 Zeichen) und den seit dem letzten Aufruf neuen Text. Die Antwort ist per JSON-Schema erzwungen (`add_icon` / `add_text` / `add_arrow` / `none`) und wird serverseitig validiert (nur bekannte Icons, keine doppelten IDs, Pfeile nur zwischen existierenden Elementen). Der System-Prompt (inkl. Icon-Liste) ist stabil und wird per Prompt-Caching gecacht — jeder Folgeaufruf liest ihn zum Bruchteil des Preises.

Das Entscheidungs-Log links unten zeigt für jeden Aufruf das Reasoning und die Aktionen — auch wenn „nichts gezeichnet" die Entscheidung war.

## Icon-Bibliothek erweitern

`public/icons.js` — ein Eintrag pro Icon: Name → Array von SVG-Pfaden (24×24-ViewBox, reine Linien, `fill: none`). Neue Icons stehen dem Agenten automatisch zur Verfügung (die Datei wird auch vom Server geladen und in Prompt + Schema übernommen). Achtung: Änderungen an der Icon-Liste invalidieren den Prompt-Cache einmalig.

## Deployment (z. B. Hetzner)

1. Repo auf den Server, `cd sketch-agent && npm install --omit=dev`, `.env` anlegen
2. Als Dienst starten, z. B. mit systemd:
   ```ini
   [Service]
   WorkingDirectory=/opt/dr-eberle-redesign/sketch-agent
   ExecStart=/usr/bin/node server.js
   Restart=always
   EnvironmentFile=/opt/dr-eberle-redesign/sketch-agent/.env
   ```
3. Reverse-Proxy mit TLS davor (Pflicht fürs Mikrofon), z. B. Caddy:
   ```
   sketch.example.com {
       reverse_proxy localhost:3000
   }
   ```
   Caddy proxied WebSockets (`/listen`) automatisch mit. Bei nginx: `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` für `/listen` nicht vergessen.

## Bekannte Grenzen / nächste Ausbaustufen

- Kein Persistieren der Canvas (Reload = leer); Export als SVG/PNG wäre der nächste Schritt
- Layout ist ein einfaches Raster mit Kollisionsausweichen — kein automatisches Umsortieren
- Ein Sprecher/Mikrofon; Diarization wäre über Deepgram-Parameter ergänzbar
