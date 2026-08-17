// Sketch-Agent Server
//
// Zwei Aufgaben:
//   1. WebSocket-Proxy /listen: leitet rohes PCM-Audio aus dem Browser an
//      Deepgrams Streaming-STT weiter und die Transkript-Events zurueck.
//      So bleibt der Deepgram-Key auf dem Server.
//   2. HTTP-Endpoint POST /api/sketch: der Sketch-Agent. Bekommt das
//      Transkript-Fenster + den aktuellen Canvas-Zustand und entscheidet
//      per Anthropic API (structured outputs), was gezeichnet wird.
//
// Start: npm install && npm start  (Keys in .env, siehe .env.example)

require("dotenv").config();

const http = require("http");
const path = require("path");
const express = require("express");
const { WebSocket, WebSocketServer } = require("ws");
const Anthropic = require("@anthropic-ai/sdk");

const SKETCH_ICONS = require("./public/icons.js");
const ICON_NAMES = Object.keys(SKETCH_ICONS);

const PORT = parseInt(process.env.PORT || "3000", 10);
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const DEEPGRAM_MODEL = process.env.DEEPGRAM_MODEL || "nova-2";
const DEEPGRAM_LANGUAGE = process.env.DEEPGRAM_LANGUAGE || "de";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";
const SKETCH_EFFORT = process.env.SKETCH_EFFORT || "low";

if (!DEEPGRAM_API_KEY) {
  console.warn("WARNUNG: DEEPGRAM_API_KEY fehlt (.env) — Transkription wird nicht funktionieren.");
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("WARNUNG: ANTHROPIC_API_KEY fehlt (.env) — der Sketch-Agent wird nicht funktionieren.");
}

const anthropic = new Anthropic();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Sketch-Agent: Entscheidung, was gezeichnet wird
// ---------------------------------------------------------------------------

const GRID_COLS = 12;
const GRID_ROWS = 8;

const SKETCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reasoning", "actions"],
  properties: {
    reasoning: {
      type: "string",
      description: "Ein kurzer Satz: warum genau diese Aktionen (oder warum keine)."
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op", "id", "icon", "label", "from", "to", "x", "y"],
        properties: {
          op: { type: "string", enum: ["add_icon", "add_text", "add_arrow", "none"] },
          id: { type: "string", description: "Neue eindeutige ID des Elements, z.B. 'n7'. Bei add_arrow und none leer lassen." },
          icon: { type: "string", enum: ICON_NAMES.concat([""]), description: "Nur bei add_icon: Icon-Name aus der Bibliothek, sonst leer." },
          label: { type: "string", description: "Bei add_icon: Beschriftung (max. 3 Woerter). Bei add_text: der Text (max. 8 Woerter). Bei add_arrow: optionale Kantenbeschriftung." },
          from: { type: "string", description: "Nur bei add_arrow: ID des Start-Elements, sonst leer." },
          to: { type: "string", description: "Nur bei add_arrow: ID des Ziel-Elements, sonst leer." },
          x: { type: "integer", description: `Spalte 0-${GRID_COLS - 1}. Bei add_arrow und none: 0.` },
          y: { type: "integer", description: `Zeile 0-${GRID_ROWS - 1}. Bei add_arrow und none: 0.` }
        }
      }
    }
  }
};

const SYSTEM_PROMPT = `Du bist ein Live-Sketchnote-Agent. Du hoerst einem Vortrag oder Gespraech zu (du bekommst alle paar Sekunden das aktuelle Transkript) und pflegst eine gemeinsame Sketch-Canvas, die das Gesagte visuell zusammenfasst — wie ein Graphic Recorder auf einer Konferenz.

Die Canvas ist ein Raster mit ${GRID_COLS} Spalten (x: 0-${GRID_COLS - 1}, links nach rechts) und ${GRID_ROWS} Zeilen (y: 0-${GRID_ROWS - 1}, oben nach unten). Jede Zelle fasst genau ein Element.

Verfuegbare Operationen:
- add_icon: Ein Icon mit kurzer Beschriftung (max. 3 Woerter) an Zelle (x, y). Das visuelle Grundelement — bevorzuge es.
- add_text: Eine kurze Textnotiz (max. 8 Woerter) an Zelle (x, y). Nur fuer Kernaussagen, die sich nicht als Icon fassen lassen.
- add_arrow: Ein Pfeil zwischen zwei bereits existierenden Elementen (from/to = deren IDs), optional mit Kantenbeschriftung. Nutze Pfeile fuer Zusammenhaenge, Abfolgen, Ursache/Wirkung.
- none: Nichts zeichnen (haeufig die richtige Wahl!).

Verfuegbare Icons: ${ICON_NAMES.join(", ")}

Regeln:
1. Zeichne SPARSAM. Ein gutes Sketchnote hat wenige, treffende Elemente. Pro Aufruf hoechstens 1-3 Aktionen, oft ist "none" richtig — etwa bei Fuellwoertern, Wiederholungen, Begruessungen oder wenn der Gedanke noch nicht abgeschlossen ist.
2. Zeichne nur, was NEU ist. Du bekommst die Liste der bereits gezeichneten Elemente — wiederhole nichts davon und vergib keine bereits vergebene ID.
3. Belege keine besetzten Zellen (die Liste zeigt die Positionen). Platziere zusammengehoerige Dinge nah beieinander; die Erzaehlung waechst grob von links oben nach rechts unten.
4. Beschriftungen sind Stichworte, keine Saetze. Sprache der Beschriftungen = Sprache des Vortrags.
5. Pfeile nur zwischen existierenden IDs.
6. Antworte ausschliesslich mit dem JSON-Objekt gemaess Schema.`;

app.post("/api/sketch", async (req, res) => {
  const { transcript_window, new_text, elements } = req.body || {};
  if (typeof transcript_window !== "string" || !transcript_window.trim()) {
    return res.status(400).json({ error: "transcript_window fehlt" });
  }

  const elementLines = (Array.isArray(elements) ? elements : [])
    .map((el) => {
      if (el.type === "arrow") return `- Pfeil ${el.from} -> ${el.to}${el.label ? ` ("${el.label}")` : ""}`;
      return `- ${el.id} [${el.type}${el.icon ? ":" + el.icon : ""}] "${el.label}" bei (${el.x},${el.y})`;
    })
    .join("\n");

  const userMessage = [
    "Bereits gezeichnete Elemente:",
    elementLines || "(Canvas ist noch leer)",
    "",
    "Transkript (letzter Ausschnitt):",
    transcript_window.trim(),
    "",
    "Davon NEU seit deinem letzten Aufruf:",
    (new_text || "").trim() || "(nichts Neues)",
    "",
    "Entscheide jetzt, was (falls ueberhaupt) gezeichnet wird."
  ].join("\n");

  try {
    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 2000,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" }
        }
      ],
      output_config: {
        effort: SKETCH_EFFORT,
        format: { type: "json_schema", schema: SKETCH_SCHEMA }
      },
      messages: [{ role: "user", content: userMessage }]
    });

    if (response.stop_reason === "refusal") {
      return res.json({ reasoning: "(Anfrage vom Modell abgelehnt)", actions: [] });
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock) {
      return res.json({ reasoning: "(leere Antwort)", actions: [] });
    }

    let decision;
    try {
      decision = JSON.parse(textBlock.text);
    } catch (e) {
      console.error("Sketch-Agent: JSON nicht parsebar:", textBlock.text.slice(0, 200));
      return res.json({ reasoning: "(Antwort nicht parsebar)", actions: [] });
    }

    // Server-seitige Validierung, damit die Canvas nie kaputte Aktionen bekommt
    const knownIds = new Set(
      (Array.isArray(elements) ? elements : []).filter((el) => el.id).map((el) => el.id)
    );
    const actions = (decision.actions || []).filter((a) => {
      if (!a || a.op === "none") return false;
      if (a.op === "add_icon") {
        return ICON_NAMES.includes(a.icon) && a.id && !knownIds.has(a.id) &&
          a.x >= 0 && a.x < GRID_COLS && a.y >= 0 && a.y < GRID_ROWS && (knownIds.add(a.id), true);
      }
      if (a.op === "add_text") {
        return a.id && a.label && !knownIds.has(a.id) &&
          a.x >= 0 && a.x < GRID_COLS && a.y >= 0 && a.y < GRID_ROWS && (knownIds.add(a.id), true);
      }
      if (a.op === "add_arrow") {
        return knownIds.has(a.from) && knownIds.has(a.to) && a.from !== a.to;
      }
      return false;
    });

    res.json({
      reasoning: decision.reasoning || "",
      actions,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens
      }
    });
  } catch (err) {
    console.error("Sketch-Agent Fehler:", err.message || err);
    res.status(502).json({ error: "Agent-Aufruf fehlgeschlagen: " + (err.message || "unbekannt") });
  }
});

// ---------------------------------------------------------------------------
// WebSocket-Proxy: Browser-Audio -> Deepgram, Transkripte -> Browser
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/listen" });

wss.on("connection", (client, req) => {
  const url = new URL(req.url, "http://localhost");
  const sampleRate = parseInt(url.searchParams.get("sample_rate") || "48000", 10);

  const dgParams = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    language: DEEPGRAM_LANGUAGE,
    encoding: "linear16",
    sample_rate: String(sampleRate),
    channels: "1",
    interim_results: "true",
    punctuate: "true",
    smart_format: "true",
    utterance_end_ms: "1200",
    vad_events: "true"
  });

  const dg = new WebSocket(`wss://api.deepgram.com/v1/listen?${dgParams}`, {
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` }
  });

  const pending = [];

  dg.on("open", () => {
    for (const chunk of pending) dg.send(chunk);
    pending.length = 0;
  });

  dg.on("message", (data) => {
    if (client.readyState === WebSocket.OPEN) client.send(data.toString());
  });

  dg.on("error", (err) => {
    console.error("Deepgram WS Fehler:", err.message);
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "ProxyError", message: err.message }));
    }
  });

  dg.on("close", () => {
    if (client.readyState === WebSocket.OPEN) client.close();
  });

  // Deepgram trennt bei laengerer Stille ohne Daten — KeepAlive verhindert das,
  // wenn der Nutzer die Aufnahme pausiert.
  const keepAlive = setInterval(() => {
    if (dg.readyState === WebSocket.OPEN) {
      dg.send(JSON.stringify({ type: "KeepAlive" }));
    }
  }, 7000);

  client.on("message", (data, isBinary) => {
    if (!isBinary) return; // Client sendet nur Audio binaer
    if (dg.readyState === WebSocket.OPEN) dg.send(data);
    else if (dg.readyState === WebSocket.CONNECTING) pending.push(data);
  });

  client.on("close", () => {
    clearInterval(keepAlive);
    if (dg.readyState === WebSocket.OPEN) {
      dg.send(JSON.stringify({ type: "CloseStream" }));
    }
    dg.close();
  });

  client.on("error", () => {
    clearInterval(keepAlive);
    dg.close();
  });
});

server.listen(PORT, () => {
  console.log(`Sketch-Agent laeuft: http://localhost:${PORT}`);
  console.log(`  STT:   Deepgram ${DEEPGRAM_MODEL} (${DEEPGRAM_LANGUAGE})`);
  console.log(`  Agent: ${ANTHROPIC_MODEL} (effort: ${SKETCH_EFFORT})`);
});
