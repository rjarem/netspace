#!/usr/bin/env bash
# Mata el server de juego de gates SIN riesgo de suicidio del wrapper.
# Regla aprendida: `pkill -f "dist/index.js"` mata también el comando que lo
# invoca si el patrón aparece en su propia línea. Este script NUNCA contiene
# el patrón literal en su cmdline del caller (el patrón vive solo aquí dentro).
PAT="dist/index""[.]js"
pkill -9 -f "$PAT" 2>/dev/null
sleep 1
echo "server de gates terminado (si estaba vivo)"
