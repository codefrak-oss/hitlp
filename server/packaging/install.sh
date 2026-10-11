#!/usr/bin/env bash
# Installs the HITLP reference server as a macOS LaunchDaemon (org.hitlp.server).
#   sudo server/packaging/install.sh --page-url https://hitlp.example.com
#   sudo server/packaging/install.sh --uninstall [--purge]
# Build first (sdks/typescript, then server: npm ci && npm run build).
# Code goes to /usr/local/lib/hitlp, settings to /usr/local/etc/hitlp (secret
# files mode 0600, owned by _hitlp; never overwritten), SQLite to /var/db/hitlp.
# --uninstall unloads the daemon and removes it and the code; --purge also
# removes settings, data, the log and the _hitlp user.
set -euo pipefail

LABEL=org.hitlp.server
PLIST=/Library/LaunchDaemons/$LABEL.plist
SVC=_hitlp
LIB=/usr/local/lib/hitlp
ETC=/usr/local/etc/hitlp
DATA=/var/db/hitlp
LOG=/var/log/hitlp.log
HERE=$(cd "$(dirname "$0")" && pwd)
SERVER=$(dirname "$HERE")

die() { echo "install.sh: $*" >&2; exit 1; }

mode=install
purge=0
page_url=
while [ $# -gt 0 ]; do
  case $1 in
    --uninstall) mode=uninstall ;;
    --purge) purge=1 ;;
    --page-url) [ $# -ge 2 ] || die "--page-url needs a value"; page_url=$2; shift ;;
    *) die "unknown argument $1" ;;
  esac
  shift
done

[ "$(uname -s)" = Darwin ] || die "macOS only"
[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"

do_uninstall() {
  launchctl bootout "system/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$LIB"
  if [ "$purge" -eq 1 ]; then
    rm -rf "$ETC" "$DATA" "$LOG"
    dscl . -delete "/Users/$SVC" 2>/dev/null || true
    dscl . -delete "/Groups/$SVC" 2>/dev/null || true
  fi
  echo "uninstalled $LABEL"
}

# The first id under 500 that is free as both a user and a group id.
free_id() {
  local id
  for id in $(seq 400 499); do
    if ! dscl . -search /Users UniqueID "$id" | grep -q . && ! dscl . -search /Groups PrimaryGroupID "$id" | grep -q .; then
      echo "$id"; return 0
    fi
  done
  die "no free id under 500"
}

create_user() {
  dscl . -read "/Users/$SVC" >/dev/null 2>&1 && return 0
  local id
  id=$(free_id)
  dscl . -create "/Groups/$SVC"
  dscl . -create "/Groups/$SVC" PrimaryGroupID "$id"
  dscl . -create "/Users/$SVC"
  dscl . -create "/Users/$SVC" UniqueID "$id"
  dscl . -create "/Users/$SVC" PrimaryGroupID "$id"
  dscl . -create "/Users/$SVC" UserShell /usr/bin/false
  dscl . -create "/Users/$SVC" NFSHomeDirectory /var/empty
  dscl . -create "/Users/$SVC" RealName "HITLP server"
  dscl . -create "/Users/$SVC" IsHidden 1
}

# Writes a settings file only if it is absent; the operator fills it in.
secret() {
  local f=$ETC/$1
  [ -e "$f" ] || printf '%s\n' "$2" >"$f"
  chown "$SVC:$SVC" "$f"
  chmod 0600 "$f"
}

do_install() {
  [ -n "$page_url" ] || die "missing required setting --page-url"
  [ -f "$SERVER/dist/src/main.js" ] || die "build the server first ($SERVER: npm ci && npm run build)"
  local node
  node=$(command -v node) || die "node not found on PATH"
  create_user
  install -d -o root -g wheel -m 0755 "$LIB"
  rm -rf "${LIB:?}/dist" "${LIB:?}/node_modules"
  # -L: @codefrak/hitlp is a relative file: link that would dangle under $LIB.
  cp -RL "$SERVER/dist" "$SERVER/node_modules" "$SERVER/package.json" "$LIB/"
  install -d -o "$SVC" -g "$SVC" -m 0700 "$ETC" "$DATA"
  secret tokens.json '{}'
  secret approvers.json '[]'
  secret admins.json '[]'
  secret surfaces.json '[]'
  touch "$LOG"; chown "$SVC:$SVC" "$LOG"; chmod 0640 "$LOG"
  launchctl bootout "system/$LABEL" 2>/dev/null || true
  sed -e "s|@NODE@|$node|" -e "s|@PAGE_URL@|$page_url|" "$HERE/$LABEL.plist" >"$PLIST"
  chown root:wheel "$PLIST"
  chmod 0644 "$PLIST"
  launchctl bootstrap system "$PLIST"
  echo "installed $LABEL: edit $ETC/*.json, then: sudo launchctl kickstart -k system/$LABEL"
}

if [ "$mode" = uninstall ]; then do_uninstall; else do_install; fi
