#!/usr/bin/env bash

set -u

cd "$(dirname "$0")" || exit 1

BASE="$(pwd)"
PASSAGGIO="$BASE/FileDiPassaggio"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$PASSAGGIO/Archivio-$STAMP"

echo "=========================================="
echo "     DIARIOFIT — MANUTENZIONE PROGETTO"
echo "=========================================="
echo
echo "Cartella: $BASE"
echo "Data:     $(date -Iseconds)"
echo "Commit:   $(git rev-parse --short HEAD 2>/dev/null || echo N/D)"
echo

mkdir -p "$PASSAGGIO"

echo "----- CONTROLLO FILE INTERMEDI -----"

CANDIDATI=()

while IFS= read -r -d '' file; do

    nome="$(basename "$file")"

    # TEST.html è il file di lavoro ufficiale e non va mai archiviato.
    [ "$nome" = "TEST.html" ] && continue

    # Archivia solo TEST intermedi più vecchi del TEST.html corrente.
    if [ -f TEST.html ] && [ "$file" -ot TEST.html ]; then
        CANDIDATI+=("$file")
    fi

done < <(find "$BASE" -maxdepth 1 -type f -name 'TEST-*.html' -print0)

# Backup index intermedi più vecchi dell'index.html ufficiale.
while IFS= read -r -d '' file; do

    if [ -f index.html ] && [ "$file" -ot index.html ]; then
        CANDIDATI+=("$file")
    fi

done < <(find "$BASE" -maxdepth 1 -type f -name 'index-PRE-*.html' -print0)

# Backup Worker intermedi.
while IFS= read -r -d '' file; do
    CANDIDATI+=("$file")
done < <(
    find "$BASE" -maxdepth 1 -type f \
      \( -name 'worker-PRE-*.js' -o \
         -name 'worker-BACKUP-*.js' -o \
         -name 'worker-*-SORGENTE.js' -o \
         -name 'worker-*.bak' -o \
         -name 'worker-*.txt' \) \
      -print0
)

if [ "${#CANDIDATI[@]}" -gt 0 ]; then

    mkdir -p "$DEST"

    for file in "${CANDIDATI[@]}"; do
        [ -f "$file" ] || continue
        echo "ARCHIVIO: $(basename "$file")"
        mv -- "$file" "$DEST/"
    done

    {
        echo "Archivio automatico DiarioFIT"
        echo "Data: $(date -Iseconds)"
        echo "Commit: $(git rev-parse --short HEAD 2>/dev/null || echo N/D)"
        echo
        echo "File:"
        find "$DEST" -maxdepth 1 -type f -printf '%f\n' | sort
    } > "$DEST/LEGGIMI.txt"

    echo
    echo "Archivio creato:"
    echo "$DEST"

else
    echo "Nessun file intermedio da archiviare."
fi

echo
echo "----- CONTROLLO D1 -----"

npx wrangler d1 execute diario-fit --remote --command \
"SELECT
 COUNT(*) AS sessioni_totali,
 SUM(CASE WHEN datetime(expires_at) < datetime('now') THEN 1 ELSE 0 END) AS scadute,
 SUM(CASE WHEN datetime(expires_at) >= datetime('now') THEN 1 ELSE 0 END) AS attive
 FROM sessions;" || echo "ATTENZIONE: controllo D1 non riuscito."

echo
echo "----- STATO GIT -----"

git status --short

echo
echo "----- FILE ROOT -----"

find "$BASE" -maxdepth 1 -type f -printf '%f\n' | sort

echo
echo "=========================================="
echo "       MANUTENZIONE COMPLETATA"
echo "=========================================="
