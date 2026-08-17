// Sketch-Agent Frontend
//
// Ablauf:
//   Mikrofon -> AudioWorklet (Int16-PCM) -> WebSocket /listen -> Deepgram
//   Deepgram-Transkripte -> Rolling Transcript + Debounce-Logik
//   Debounce feuert -> POST /api/sketch -> Aktionen -> SketchCanvas
//
// Debounce-Regeln (unten als Konstanten, zum Live-Testen gedacht):
//   - fruehestens alle MIN_INTERVAL_MS ein Agent-Aufruf
//   - nur wenn seit dem letzten Aufruf mindestens MIN_NEW_CHARS neue
//     (finalisierte) Zeichen dazugekommen sind
//   - Ausloeser: Deepgram "UtteranceEnd" (Sprecher macht Pause) oder
//     spaetestens nach MAX_INTERVAL_MS, wenn weiter gesprochen wird
//   - nie zwei Aufrufe parallel

(function () {
  const MIN_INTERVAL_MS = 6000;   // Mindestabstand zwischen Agent-Aufrufen
  const MAX_INTERVAL_MS = 18000;  // spaetestens dann aufrufen, wenn Neues da ist
  const MIN_NEW_CHARS = 60;       // so viel neuer Text muss mindestens da sein
  const TRANSCRIPT_WINDOW_CHARS = 1600; // Kontextfenster fuer den Agenten

  const els = {
    startBtn: document.getElementById("start-btn"),
    clearBtn: document.getElementById("clear-btn"),
    status: document.getElementById("status"),
    transcript: document.getElementById("transcript"),
    interim: document.getElementById("interim"),
    log: document.getElementById("agent-log"),
    canvasSvg: document.getElementById("sketch-svg")
  };

  const canvas = new window.SketchCanvas(els.canvasSvg);

  let running = false;
  let ws = null;
  let audioCtx = null;
  let workletNode = null;
  let mediaStream = null;

  // Transkript-Zustand
  let finalText = "";          // alle finalisierten Segmente
  let agentCursor = 0;         // Position in finalText bis zu der der Agent alles kennt
  let lastAgentCall = 0;
  let agentInFlight = false;
  let utteranceEnded = false;
  let tickTimer = null;

  function setStatus(text, cls) {
    els.status.textContent = text;
    els.status.className = "status " + (cls || "");
  }

  function appendLog(entry, cls) {
    const div = document.createElement("div");
    div.className = "log-entry " + (cls || "");
    div.innerHTML = entry;
    els.log.prepend(div);
    while (els.log.children.length > 60) els.log.lastChild.remove();
  }

  function renderTranscript() {
    els.transcript.textContent = finalText;
    els.transcript.parentElement.scrollTop = els.transcript.parentElement.scrollHeight;
  }

  // ------------------------------------------------------------------
  // Agent-Loop
  // ------------------------------------------------------------------

  function maybeCallAgent(reason) {
    if (agentInFlight) return;
    const now = Date.now();
    const newChars = finalText.length - agentCursor;
    if (newChars < MIN_NEW_CHARS) return;
    if (now - lastAgentCall < MIN_INTERVAL_MS) return;

    const forced = now - lastAgentCall >= MAX_INTERVAL_MS;
    if (!utteranceEnded && !forced) return;

    callAgent(reason + (forced ? " (Max-Intervall)" : ""));
  }

  async function callAgent(reason) {
    agentInFlight = true;
    utteranceEnded = false;
    lastAgentCall = Date.now();

    const windowText = finalText.slice(-TRANSCRIPT_WINDOW_CHARS);
    const newText = finalText.slice(agentCursor);
    agentCursor = finalText.length;

    appendLog(`<span class="log-time">${new Date().toLocaleTimeString()}</span> Agent-Aufruf (${reason}) — ${newText.length} neue Zeichen`, "log-call");

    try {
      const res = await fetch("/api/sketch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript_window: windowText,
          new_text: newText,
          elements: canvas.getState()
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        appendLog(`Fehler: ${err.error || res.status}`, "log-error");
        return;
      }

      const decision = await res.json();
      const drawn = canvas.apply(decision.actions);

      const summary = (decision.actions || [])
        .map((a) => {
          if (a.op === "add_icon") return `Icon <b>${a.icon}</b> "${a.label}" @(${a.x},${a.y})`;
          if (a.op === "add_text") return `Text "${a.label}" @(${a.x},${a.y})`;
          if (a.op === "add_arrow") return `Pfeil ${a.from}→${a.to}${a.label ? ` "${a.label}"` : ""}`;
          return a.op;
        })
        .join("<br>");

      appendLog(
        `<span class="log-reasoning">${escapeHtml(decision.reasoning || "")}</span>` +
        (drawn ? `<div class="log-actions">${summary}</div>` : `<div class="log-actions log-none">→ nichts gezeichnet</div>`),
        drawn ? "log-drawn" : "log-skip"
      );
    } catch (e) {
      appendLog(`Netzwerkfehler: ${escapeHtml(e.message)}`, "log-error");
    } finally {
      agentInFlight = false;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ------------------------------------------------------------------
  // Deepgram-Events
  // ------------------------------------------------------------------

  function handleDeepgramMessage(msg) {
    if (msg.type === "Results") {
      const alt = msg.channel && msg.channel.alternatives && msg.channel.alternatives[0];
      const text = alt ? alt.transcript : "";
      if (msg.is_final) {
        els.interim.textContent = "";
        if (text.trim()) {
          finalText += (finalText && !finalText.endsWith(" ") ? " " : "") + text.trim();
          renderTranscript();
        }
        if (msg.speech_final) {
          utteranceEnded = true;
          maybeCallAgent("Sprechpause");
        }
      } else if (text.trim()) {
        els.interim.textContent = text;
        els.transcript.parentElement.scrollTop = els.transcript.parentElement.scrollHeight;
      }
    } else if (msg.type === "UtteranceEnd") {
      utteranceEnded = true;
      maybeCallAgent("UtteranceEnd");
    } else if (msg.type === "ProxyError") {
      setStatus("STT-Fehler: " + msg.message, "error");
    }
  }

  // ------------------------------------------------------------------
  // Audio + WebSocket Lifecycle
  // ------------------------------------------------------------------

  async function start() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });
    } catch (e) {
      setStatus("Mikrofonzugriff verweigert", "error");
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.audioWorklet.addModule("audio-worklet.js");

    const source = audioCtx.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioCtx, "pcm-capture");
    source.connect(workletNode);

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/listen?sample_rate=${audioCtx.sampleRate}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setStatus("Aufnahme laeuft — sprich einfach los", "recording");
      workletNode.port.onmessage = (e) => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };
    };

    ws.onmessage = (e) => {
      try {
        handleDeepgramMessage(JSON.parse(e.data));
      } catch (_) { /* Nicht-JSON ignorieren */ }
    };

    ws.onclose = () => {
      if (running) setStatus("Verbindung getrennt", "error");
    };

    ws.onerror = () => setStatus("WebSocket-Fehler", "error");

    // Regelmaessiger Check fuer das Max-Intervall (falls jemand ohne Pause spricht)
    tickTimer = setInterval(() => maybeCallAgent("Intervall"), 1000);

    running = true;
    els.startBtn.textContent = "⏹ Stopp";
    els.startBtn.classList.add("running");
  }

  function stop() {
    running = false;
    clearInterval(tickTimer);
    if (ws) { ws.close(); ws = null; }
    if (workletNode) { workletNode.disconnect(); workletNode = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    setStatus("Gestoppt", "");
    els.startBtn.textContent = "🎙 Start";
    els.startBtn.classList.remove("running");

    // Letzter Agent-Aufruf mit dem Rest-Transkript
    if (finalText.length - agentCursor > 20 && !agentInFlight) {
      utteranceEnded = true;
      lastAgentCall = 0;
      callAgent("Session-Ende");
    }
  }

  els.startBtn.addEventListener("click", () => (running ? stop() : start()));

  els.clearBtn.addEventListener("click", () => {
    canvas.clear();
    finalText = "";
    agentCursor = 0;
    els.transcript.textContent = "";
    els.interim.textContent = "";
    els.log.innerHTML = "";
    setStatus(running ? "Aufnahme laeuft — sprich einfach los" : "Bereit", running ? "recording" : "");
  });

  setStatus("Bereit — Start druecken und sprechen", "");
})();
