#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

for python in \
  /opt/homebrew/bin/python3 \
  /usr/local/bin/python3 \
  /Library/Frameworks/Python.framework/Versions/Current/bin/python3 \
  /usr/bin/python3
 do
  if [ -x "$python" ]; then
    exec "$python" "$SCRIPT_DIR/caixa_forta_native.py"
  fi
done

printf '%s\n' 'Caixa Forta: no s\x27ha trobat Python 3.' >&2
exit 127
