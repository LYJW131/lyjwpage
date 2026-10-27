#!/bin/bash
set -euo pipefail

if ! command -v certutil >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y -q libnss3-tools >/dev/null 2>&1 \
    || { apt-get update -q >/dev/null && apt-get install -y -q libnss3-tools >/dev/null; }
fi

cat >/usr/local/bin/ccr-chromium-trust <<'EOF'
#!/bin/sh
CA=/root/.ccr/agent-proxy-ca.crt
DB="${HOME:-/root}/.pki/nssdb"
[ -r "$CA" ] && command -v certutil >/dev/null 2>&1 || exit 0
STAMP="$DB/.ccr-agent-proxy-ca.sha256"
SUM=$(sha256sum "$CA" | cut -d' ' -f1)
[ "$(cat "$STAMP" 2>/dev/null)" = "$SUM" ] && exit 0
mkdir -p "$DB"
(
  flock 9
  [ "$(cat "$STAMP" 2>/dev/null)" = "$SUM" ] && exit 0
  [ -f "$DB/cert9.db" ] || certutil -d "sql:$DB" -N --empty-password
  for nick in $(certutil -d "sql:$DB" -L | awk '/^ccr-agent-proxy-[0-9]+ /{print $1}'); do
    certutil -d "sql:$DB" -D -n "$nick"
  done
  TMP=$(mktemp -d)
  awk -v dir="$TMP" '/BEGIN CERTIFICATE/{n++} n{print > (dir "/" n ".pem")}' "$CA"
  for pem in "$TMP"/*.pem; do
    certutil -d "sql:$DB" -A -t "C,," -n "ccr-agent-proxy-$(basename "$pem" .pem)" -i "$pem"
  done
  rm -rf "$TMP"
  echo "$SUM" >"$STAMP"
) 9>"$DB/.ccr-agent-proxy-ca.lock"
EOF
chmod 755 /usr/local/bin/ccr-chromium-trust

for dir in /opt/pw-browsers "${HOME:-/root}/.cache/ms-playwright"; do
  [ -d "$dir" ] || continue
  find "$dir" -type f \( -name chrome -o -name headless_shell \) -path '*/chrome-linux*/*' | while read -r bin; do
    if [ ! -e "$bin.real" ]; then
      mv "$bin" "$bin.real"
    elif head -c 2 "$bin" | grep -q '#!'; then
      :
    else
      continue
    fi
    printf '#!/bin/sh\n/usr/local/bin/ccr-chromium-trust >/dev/null 2>&1\nexec "%s.real" "$@"\n' "$bin" >"$bin"
    chmod 755 "$bin"
  done
done

PW=$(command -v playwright || echo /opt/node22/bin/playwright)
if [ -x "$PW" ]; then
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers timeout 600 "$PW" install --with-deps webkit >/dev/null 2>&1 \
    || echo "webkit install failed" >&2
fi
