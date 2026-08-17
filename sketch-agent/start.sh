#!/usr/bin/env bash
# Sketch-Agent: Einrichten und starten.
# Aufruf:  ./start.sh
# Fragt beim ersten Mal nach den beiden API-Keys, danach startet es direkt.

set -e
cd "$(dirname "$0")"

echo ""
echo "  ✏️  Sketch-Agent"
echo "  ────────────────────────────────────────────"
echo ""

# 1. Node vorhanden?
if ! command -v node >/dev/null 2>&1; then
  echo "  ✗ Node.js ist nicht installiert."
  echo ""
  echo "    Installiere es mit einem der beiden Wege:"
  echo "      • Homebrew:  brew install node"
  echo "      • Download:  https://nodejs.org  (LTS-Version nehmen)"
  echo ""
  echo "    Danach dieses Skript nochmal starten."
  echo ""
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "  ✗ Node.js $(node -v) ist zu alt — gebraucht wird mindestens v18."
  echo "    Aktualisieren mit:  brew upgrade node"
  echo ""
  exit 1
fi
echo "  ✓ Node.js $(node -v)"

# 2. Abhaengigkeiten
if [ ! -d node_modules ]; then
  echo "  … installiere Abhaengigkeiten (dauert ca. 20 Sekunden)"
  npm install --silent --no-audit --no-fund
fi
echo "  ✓ Abhaengigkeiten installiert"

# 3. Keys
if [ ! -f .env ]; then
  echo ""
  echo "  Zwei API-Keys werden gebraucht. Sie werden nur lokal in der"
  echo "  Datei .env gespeichert und verlassen deinen Rechner nicht."
  echo ""
  echo "  1) Deepgram — fuer die Spracherkennung"
  echo "     Key holen: https://console.deepgram.com  (Startguthaben inklusive)"
  printf "     Key eingeben: "
  read -r DG_KEY
  echo ""
  echo "  2) Anthropic — fuer den zeichnenden Agenten"
  echo "     Key holen: https://platform.claude.com"
  printf "     Key eingeben: "
  read -r ANT_KEY
  echo ""

  if [ -z "$DG_KEY" ] || [ -z "$ANT_KEY" ]; then
    echo "  ✗ Beide Keys werden gebraucht. Bitte nochmal starten."
    echo ""
    exit 1
  fi

  cat > .env <<EOF
DEEPGRAM_API_KEY=$DG_KEY
ANTHROPIC_API_KEY=$ANT_KEY
PORT=3000
DEEPGRAM_MODEL=nova-2
DEEPGRAM_LANGUAGE=de
ANTHROPIC_MODEL=claude-opus-5
SKETCH_EFFORT=low
EOF
  echo "  ✓ Keys in .env gespeichert"
else
  echo "  ✓ Keys gefunden (.env)"
fi

# 4. Browser oeffnen, sobald der Server bereit ist
PORT_USED=$(grep -E '^PORT=' .env | cut -d= -f2)
PORT_USED=${PORT_USED:-3000}
URL="http://localhost:${PORT_USED}"

( sleep 2; command -v open >/dev/null 2>&1 && open "$URL" ) &

echo ""
echo "  ────────────────────────────────────────────"
echo "  Startet auf $URL"
echo "  Der Browser oeffnet sich gleich von selbst."
echo ""
echo "  Dann: 'Start' druecken, Mikrofon erlauben, losreden."
echo "  Beenden mit Ctrl+C."
echo "  ────────────────────────────────────────────"
echo ""

npm start
