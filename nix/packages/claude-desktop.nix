{ writeShellApplication, writeText, sway, coreutils, background ? "#1c1b19" }:

let
  # Claude's own compositor: headless output, its own seat, nothing shared with the user's input.
  config = writeText "antonio-claude-sway.conf" ''
    output HEADLESS-1 mode 1280x800 bg ${background} solid_color
    workspace_layout tabbed
    default_border normal 2
    focus_follows_mouse no
    font pango:Inter 10
    exec sh -c 'printf "WAYLAND_DISPLAY=%s/%s\nSWAYSOCK=%s\nDISPLAY=%s\n" "$XDG_RUNTIME_DIR" "$WAYLAND_DISPLAY" "$SWAYSOCK" "$DISPLAY" > "$ANTONIO_ENV_FILE"'
  '';
in
writeShellApplication {
  name = "antonio-claude-desktop";
  runtimeInputs = [ sway coreutils ];
  text = ''
    dir="''${XDG_RUNTIME_DIR:?}/antonio"
    mkdir -p "$dir"
    export ANTONIO_ENV_FILE="$dir/claude-desktop.env"
    rm -f "$ANTONIO_ENV_FILE"
    trap 'rm -f "$ANTONIO_ENV_FILE"' EXIT
    export WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 WLR_HEADLESS_OUTPUTS=1
    export XDG_CURRENT_DESKTOP=sway:antonio-claude
    unset WAYLAND_DISPLAY DISPLAY SWAYSOCK I3SOCK
    sway -c ${config} "$@"
  '';
}
