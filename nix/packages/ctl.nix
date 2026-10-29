{ writeShellApplication, curl, procps }:

writeShellApplication {
  name = "antonio-ctl";
  runtimeInputs = [ curl procps ];
  text = ''
    state="''${ANTONIO_STATE_DIR:-''${XDG_STATE_HOME:-$HOME/.local/state}/antonio}"
    url="http://127.0.0.1:''${ANTONIO_PORT:-7777}"
    case "''${1:-}" in
      toggle) pkill -USR1 -f antonio-sidebar ;;
      panic) curl -fsS -X POST -H "x-antonio-token: $(cat "$state/token")" "$url/api/panic" ;;
      *) echo "uso: antonio-ctl toggle|panic" >&2; exit 2 ;;
    esac
  '';
}
