#!/usr/bin/env bash
# Runs the whole Antonio stack in a nested/headless Sway for development:
#   nix develop -c scripts/dev-session.sh [--headless]
# Starts: a "user" Sway, Claude's desktop, antonio-agentd (system changes in dry-run) and the sidebar.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
run=${XDG_RUNTIME_DIR:-/tmp/antonio-dev-$UID}
mkdir -p "$run" && chmod 700 "$run"
export XDG_RUNTIME_DIR=$run
export ANTONIO_STATE_DIR=${ANTONIO_STATE_DIR:-$root/.dev/state}
export ANTONIO_WORKSPACE=${ANTONIO_WORKSPACE:-$root/.dev/workspace}
export ANTONIO_CONFIG_REPO=${ANTONIO_CONFIG_REPO:-$root/.dev/etc-antonio}
export ANTONIO_UI_DIR=$root/sidebar/web
export ANTONIO_DRY_RUN_SYSTEM=1
mkdir -p "$ANTONIO_STATE_DIR" "$ANTONIO_WORKSPACE"
if [ ! -d "$ANTONIO_CONFIG_REPO/.git" ]; then
  mkdir -p "$ANTONIO_CONFIG_REPO" && cp -r "$root/nix/template/." "$ANTONIO_CONFIG_REPO/"
  git -C "$ANTONIO_CONFIG_REPO" init -q -b main && git -C "$ANTONIO_CONFIG_REPO" add -A
  git -C "$ANTONIO_CONFIG_REPO" -c user.name=dev -c user.email=dev@localhost commit -q -m "Configuração inicial"
fi

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT

# The "user" desktop: nested in the current Wayland session, or headless.
user_env=$run/user-desktop.env
rm -f "$user_env"
cat > "$run/user-sway.conf" <<CONF
output * bg #1c1b19 solid_color
exec sh -c 'printf "WAYLAND_DISPLAY=%s\nSWAYSOCK=%s\n" "\$WAYLAND_DISPLAY" "\$SWAYSOCK" > $user_env'
CONF
if [ "${1:-}" = "--headless" ] || [ -z "${WAYLAND_DISPLAY:-}" ]; then
  (export WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 WLR_HEADLESS_OUTPUTS=1
   unset WAYLAND_DISPLAY DISPLAY SWAYSOCK; exec sway -c "$run/user-sway.conf") &
else
  (unset SWAYSOCK; exec sway -c "$run/user-sway.conf") &
fi
pids+=($!)
until [ -s "$user_env" ]; do sleep 0.2; done
set -a; . "$user_env"; set +a

# Claude's desktop: separate compositor, separate seat.
(export ANTONIO_ENV_FILE=$run/antonio/claude-desktop.env; mkdir -p "$run/antonio"
 export WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 WLR_HEADLESS_OUTPUTS=1
 unset WAYLAND_DISPLAY DISPLAY SWAYSOCK
 cat > "$run/claude-sway.conf" <<CONF
output HEADLESS-1 mode 1280x800 bg #1e1e2e solid_color
workspace_layout tabbed
exec sh -c 'printf "WAYLAND_DISPLAY=%s\nSWAYSOCK=%s\n" "\$WAYLAND_DISPLAY" "\$SWAYSOCK" > \$ANTONIO_ENV_FILE'
CONF
 exec sway -c "$run/claude-sway.conf") &
pids+=($!)

(cd "$root/agentd" && [ -d dist ] || npm run build >/dev/null; exec node "$root/agentd/dist/main.js") &
pids+=($!)
sleep 1
"${ANTONIO_SIDEBAR:-antonio-sidebar}" &
pids+=($!)
echo "Antonio rodando. WAYLAND_DISPLAY=$WAYLAND_DISPLAY (usuário). Ctrl+C para sair."
wait
