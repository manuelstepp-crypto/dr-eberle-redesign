// Sketch-Canvas: rendert die Agent-Aktionen als animierte SVG-Sketchnotes.
// Icons und Pfeile werden mit einer Stroke-Dashoffset-Animation "gezeichnet",
// Texte faden ein. Ein leichter Zufalls-Tilt gibt den Elementen Handskizzen-Optik.

(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const GRID_COLS = 12;
  const GRID_ROWS = 8;
  const CELL_W = 100;
  const CELL_H = 100;
  const ICON_SIZE = 46;

  const COLORS = ["#1d3557", "#e63946", "#2a9d8f", "#e76f51", "#457b9d", "#6d597a"];

  class SketchCanvas {
    constructor(svgEl) {
      this.svg = svgEl;
      this.svg.setAttribute("viewBox", `0 0 ${GRID_COLS * CELL_W} ${GRID_ROWS * CELL_H}`);
      this.elements = new Map(); // id -> {type, icon, label, x, y, node, cx, cy}
      this.arrows = [];
      this.colorIndex = 0;

      this._initDefs();
      this.arrowLayer = document.createElementNS(SVG_NS, "g");
      this.nodeLayer = document.createElementNS(SVG_NS, "g");
      this.svg.appendChild(this.arrowLayer);
      this.svg.appendChild(this.nodeLayer);
    }

    _initDefs() {
      const defs = document.createElementNS(SVG_NS, "defs");
      defs.innerHTML =
        '<marker id="arrowhead" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto">' +
        '<path d="M0 0 L9 4 L0 8" fill="none" stroke="#555" stroke-width="1.6" stroke-linecap="round"/>' +
        "</marker>";
      this.svg.appendChild(defs);
    }

    _nextColor() {
      return COLORS[this.colorIndex++ % COLORS.length];
    }

    _cellCenter(x, y) {
      return { cx: x * CELL_W + CELL_W / 2, cy: y * CELL_H + CELL_H / 2 };
    }

    // Falls die Zielzelle belegt ist: naechste freie Zelle spiralfoermig suchen.
    _resolveCell(x, y) {
      const occupied = new Set(
        [...this.elements.values()].filter((e) => e.type !== "arrow").map((e) => `${e.x},${e.y}`)
      );
      if (!occupied.has(`${x},${y}`)) return { x, y };
      for (let r = 1; r < Math.max(GRID_COLS, GRID_ROWS); r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue;
            if (!occupied.has(`${nx},${ny}`)) return { x: nx, y: ny };
          }
        }
      }
      return { x, y };
    }

    _animateStrokes(group, delayStep = 180) {
      const paths = group.querySelectorAll("path, line, circle");
      let delay = 0;
      paths.forEach((p) => {
        const len = typeof p.getTotalLength === "function" ? p.getTotalLength() : 100;
        p.style.strokeDasharray = len;
        p.style.strokeDashoffset = len;
        p.style.transition = `stroke-dashoffset ${Math.min(0.9, 0.25 + len / 300)}s ease-out ${delay / 1000}s`;
        delay += delayStep;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          p.style.strokeDashoffset = 0;
        }));
      });
      return delay;
    }

    addIcon(id, iconName, label, x, y) {
      const paths = window.SKETCH_ICONS[iconName];
      if (!paths || this.elements.has(id)) return;
      const cell = this._resolveCell(x, y);
      const { cx, cy } = this._cellCenter(cell.x, cell.y);
      const color = this._nextColor();
      const tilt = (Math.random() * 6 - 3).toFixed(1);

      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("transform", `translate(${cx}, ${cy - 8}) rotate(${tilt})`);

      const iconG = document.createElementNS(SVG_NS, "g");
      const scale = ICON_SIZE / 24;
      iconG.setAttribute(
        "transform",
        `translate(${-ICON_SIZE / 2}, ${-ICON_SIZE / 2 - 6}) scale(${scale})`
      );
      for (const d of paths) {
        const p = document.createElementNS(SVG_NS, "path");
        p.setAttribute("d", d);
        p.setAttribute("fill", "none");
        p.setAttribute("stroke", color);
        p.setAttribute("stroke-width", "1.7");
        p.setAttribute("stroke-linecap", "round");
        p.setAttribute("stroke-linejoin", "round");
        iconG.appendChild(p);
      }
      g.appendChild(iconG);

      if (label) {
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("y", ICON_SIZE / 2 + 8);
        text.setAttribute("class", "node-label");
        text.setAttribute("fill", color);
        text.textContent = label;
        text.style.opacity = "0";
        text.style.transition = "opacity 0.5s ease-in 0.4s";
        g.appendChild(text);
        requestAnimationFrame(() => requestAnimationFrame(() => (text.style.opacity = "1")));
      }

      this.nodeLayer.appendChild(g);
      this._animateStrokes(iconG);
      this.elements.set(id, { id, type: "icon", icon: iconName, label, x: cell.x, y: cell.y, node: g, cx, cy });
    }

    addText(id, textContent, x, y) {
      if (this.elements.has(id)) return;
      const cell = this._resolveCell(x, y);
      const { cx, cy } = this._cellCenter(cell.x, cell.y);
      const tilt = (Math.random() * 4 - 2).toFixed(1);

      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${tilt})`);

      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("class", "note-text");

      // Einfacher Zeilenumbruch bei ~16 Zeichen
      const words = String(textContent).split(/\s+/);
      const lines = [];
      let line = "";
      for (const w of words) {
        if ((line + " " + w).trim().length > 16 && line) {
          lines.push(line.trim());
          line = w;
        } else {
          line = (line + " " + w).trim();
        }
      }
      if (line) lines.push(line);

      const startDy = -((lines.length - 1) * 9);
      lines.forEach((l, i) => {
        const tspan = document.createElementNS(SVG_NS, "tspan");
        tspan.setAttribute("x", "0");
        tspan.setAttribute("dy", i === 0 ? startDy : 18);
        tspan.textContent = l;
        text.appendChild(tspan);
      });

      g.appendChild(text);
      g.style.opacity = "0";
      g.style.transition = "opacity 0.6s ease-in";
      this.nodeLayer.appendChild(g);
      requestAnimationFrame(() => requestAnimationFrame(() => (g.style.opacity = "1")));

      this.elements.set(id, { id, type: "text", label: textContent, x: cell.x, y: cell.y, node: g, cx, cy });
    }

    addArrow(fromId, toId, label) {
      const a = this.elements.get(fromId);
      const b = this.elements.get(toId);
      if (!a || !b) return;

      // Linie zwischen den Zentren, an beiden Enden gekuerzt
      const dx = b.cx - a.cx;
      const dy = b.cy - a.cy;
      const dist = Math.hypot(dx, dy) || 1;
      const pad = 42;
      const x1 = a.cx + (dx / dist) * pad;
      const y1 = a.cy + (dy / dist) * pad;
      const x2 = b.cx - (dx / dist) * (pad + 6);
      const y2 = b.cy - (dy / dist) * (pad + 6);

      // Leichte Kruemmung fuer Handskizzen-Optik
      const mx = (x1 + x2) / 2 - dy / dist * 14;
      const my = (y1 + y2) / 2 + dx / dist * 14;

      const g = document.createElementNS(SVG_NS, "g");
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`);
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "#555");
      p.setAttribute("stroke-width", "1.6");
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("marker-end", "url(#arrowhead)");
      g.appendChild(p);

      if (label) {
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", mx);
        text.setAttribute("y", my - 6);
        text.setAttribute("class", "arrow-label");
        text.textContent = label;
        text.style.opacity = "0";
        text.style.transition = "opacity 0.5s ease-in 0.5s";
        g.appendChild(text);
        requestAnimationFrame(() => requestAnimationFrame(() => (text.style.opacity = "1")));
      }

      this.arrowLayer.appendChild(g);
      this._animateStrokes(g, 0);
      this.arrows.push({ type: "arrow", from: fromId, to: toId, label: label || "" });
    }

    // Aktionen des Agenten anwenden; gibt die Zahl tatsaechlich gezeichneter Elemente zurueck.
    apply(actions) {
      let drawn = 0;
      for (const a of actions || []) {
        if (a.op === "add_icon") {
          this.addIcon(a.id, a.icon, a.label, a.x, a.y);
          drawn++;
        } else if (a.op === "add_text") {
          this.addText(a.id, a.label, a.x, a.y);
          drawn++;
        } else if (a.op === "add_arrow") {
          this.addArrow(a.from, a.to, a.label);
          drawn++;
        }
      }
      return drawn;
    }

    // Zustand fuer den Agenten serialisieren
    getState() {
      const els = [...this.elements.values()].map((e) => ({
        id: e.id, type: e.type, icon: e.icon || "", label: e.label || "", x: e.x, y: e.y
      }));
      return els.concat(this.arrows);
    }

    clear() {
      this.elements.clear();
      this.arrows = [];
      this.colorIndex = 0;
      this.arrowLayer.innerHTML = "";
      this.nodeLayer.innerHTML = "";
    }
  }

  window.SketchCanvas = SketchCanvas;
})();
