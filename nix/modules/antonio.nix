{ config, lib, pkgs, antonioSource, nixpkgs, ... }:

let
  cfg = config.antonio;
  antonioPkgs = import ../packages { inherit pkgs; };
  inherit (antonioPkgs) antonio-agentd antonio-sidebar antonio-claude-desktop antonio-ctl;

  repo = "/etc/antonio";
  flakeRef = "path:${repo}#antonio";
  rebuildPath = [ config.nix.package pkgs.git pkgs.nixos-rebuild-ng pkgs.coreutils pkgs.systemd ];

  seed = pkgs.writeShellApplication {
    name = "antonio-seed";
    runtimeInputs = [ pkgs.coreutils pkgs.git pkgs.gnused pkgs.util-linux config.nix.package config.system.build.nixos-generate-config ];
    text = ''
      repo=${repo}
      [ -e "$repo/flake.nix" ] && exit 0
      mkdir -p "$repo"
      cp --no-preserve=mode -r ${../template}/. "$repo/"
      sed -i \
        -e "s|@source@|${antonioSource}|g" \
        -e "s|@user@|${cfg.user}|g" \
        -e "s|@profile@|${cfg.seed.profile}|g" \
        "$repo"/*.nix
      ${lib.optionalString (cfg.seed.profile == "hardware") ''
        nixos-generate-config --show-hardware-config > "$repo/hardware-configuration.nix"
      ''}
      chown -R ${cfg.user}:antonio "$repo"
      chmod -R g+w "$repo"
      as_user() { runuser -u ${cfg.user} -- env HOME=/home/${cfg.user} "$@"; }
      as_user nix --extra-experimental-features "nix-command flakes" flake lock "path:$repo" || true
      as_user git -C "$repo" init -q -b main
      as_user git -C "$repo" add -A
      as_user git -C "$repo" -c user.name="Antonio OS" -c user.email=antonio@localhost commit -q -m "Configuração inicial"
    '';
  };

  swayConfig = pkgs.writeText "antonio.conf" ''
    # Antonio OS — integração com a barra lateral do Claude
    exec "systemctl --user import-environment WAYLAND_DISPLAY SWAYSOCK DISPLAY XDG_CURRENT_DESKTOP && systemctl --user start antonio-session.target"
    bindsym --no-warn Mod4+space exec ${antonio-ctl}/bin/antonio-ctl toggle
    bindsym --no-warn Mod4+Escape exec ${antonio-ctl}/bin/antonio-ctl panic
    input type:keyboard xkb_layout ${cfg.keyboardLayout}
    output * bg ${cfg.background} solid_color
    default_border pixel 2
    gaps inner 6
    client.focused ${cfg.accent} ${cfg.accent} #ffffff ${cfg.accent} ${cfg.accent}
  '';
in
{
  options.antonio = {
    enable = lib.mkEnableOption "Antonio OS (Claude integrado à área de trabalho)";
    user = lib.mkOption {
      type = lib.types.str;
      description = "Usuário principal, dono da configuração editável em ${repo}.";
    };
    autoLogin = lib.mkOption { type = lib.types.bool; default = false; };
    keyboardLayout = lib.mkOption { type = lib.types.str; default = "br"; };
    background = lib.mkOption { type = lib.types.str; default = "#1c1b19"; };
    accent = lib.mkOption { type = lib.types.str; default = "#d97757"; };
    model = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Modelo do Claude; null usa o padrão da conta.";
    };
    confirmSeconds = lib.mkOption {
      type = lib.types.int;
      default = 60;
      description = "Tempo para confirmar uma mudança no sistema antes de reverter sozinho.";
    };
    seed.profile = lib.mkOption {
      type = lib.types.enum [ "vm" "iso" "hardware" ];
      default = "hardware";
      description = "Como gerar a configuração inicial em ${repo} no primeiro boot.";
    };
  };

  config = lib.mkIf cfg.enable {
    nixpkgs.config.allowUnfreePredicate = pkg: builtins.elem (lib.getName pkg) [ "claude-code" ];
    nix.settings.experimental-features = [ "nix-command" "flakes" ];
    # Keeps the pinned nixpkgs source in the store so /etc/antonio rebuilds work offline.
    nix.registry.nixpkgs.flake = nixpkgs;
    nix.nixPath = [ "nixpkgs=${nixpkgs}" ];

    users.groups.antonio = { };
    users.users.${cfg.user}.extraGroups = [ "antonio" ];

    # ---------- desktop ----------
    programs.sway = {
      enable = true;
      wrapperFeatures.gtk = true;
      extraPackages = with pkgs; [ foot wmenu swaylock swayidle grim slurp wtype wl-clipboard mako ];
    };
    environment.etc."sway/config.d/antonio.conf".source = swayConfig;

    services.greetd = {
      enable = true;
      settings = {
        default_session.command = "${pkgs.tuigreet}/bin/tuigreet --time --remember --cmd sway";
      } // lib.optionalAttrs cfg.autoLogin {
        initial_session = { command = "sway"; user = cfg.user; };
      };
    };

    environment.systemPackages = [ antonio-ctl antonio-sidebar pkgs.claude-code pkgs.git pkgs.firefox pkgs.jq ];
    fonts.packages = with pkgs; [ inter noto-fonts noto-fonts-color-emoji jetbrains-mono ];
    services.pipewire = { enable = true; pulse.enable = true; };
    networking.networkmanager.enable = true;
    security.polkit.enable = true;
    services.dbus.enable = true;

    # ---------- user session: agent, Claude's desktop, sidebar ----------
    systemd.user.targets.antonio-session = {
      description = "Antonio OS (sessão do Claude)";
      wants = [ "antonio-agentd.service" "antonio-claude-desktop.service" "antonio-sidebar.service" ];
    };

    systemd.user.services.antonio-claude-desktop = {
      description = "Área do Claude (compositor separado, com mouse e teclado próprios)";
      partOf = [ "antonio-session.target" ];
      serviceConfig = {
        ExecStart = "${antonio-claude-desktop}/bin/antonio-claude-desktop";
        Restart = "on-failure";
        RestartSec = 2;
      };
    };

    systemd.user.services.antonio-agentd = {
      description = "Antonio agent daemon (Claude Agent SDK)";
      partOf = [ "antonio-session.target" ];
      after = [ "antonio-claude-desktop.service" ];
      path = with pkgs; [ sway grim wtype foot git coreutils procps systemd nixos-rebuild-ng config.nix.package bash ripgrep findutils gnugrep gnused curl util-linux ];
      environment = {
        ANTONIO_UI_DIR = "${antonio-sidebar}/share/antonio/web";
        ANTONIO_CLAUDE_BIN = lib.getExe pkgs.claude-code;
        ANTONIO_CONFIG_REPO = repo;
        ANTONIO_CONFIRM_SECONDS = toString cfg.confirmSeconds;
        DISABLE_AUTOUPDATER = "1";
      } // lib.optionalAttrs (cfg.model != null) { ANTONIO_MODEL = cfg.model; };
      serviceConfig = {
        ExecStart = lib.getExe antonio-agentd;
        Restart = "on-failure";
        RestartSec = 2;
      };
    };

    systemd.user.services.antonio-sidebar = {
      description = "Barra lateral do Antonio";
      partOf = [ "antonio-session.target" ];
      after = [ "antonio-agentd.service" ];
      serviceConfig = {
        ExecStart = lib.getExe antonio-sidebar;
        Restart = "on-failure";
        RestartSec = 2;
      };
    };

    # ---------- self-modification with automatic rollback ----------
    systemd.services.antonio-seed = {
      description = "Cria a configuração editável do Antonio OS em ${repo}";
      wantedBy = [ "multi-user.target" ];
      before = [ "greetd.service" ];
      after = [ "nix-daemon.socket" ];
      serviceConfig = { Type = "oneshot"; ExecStart = lib.getExe seed; };
    };

    systemd.services.antonio-apply = {
      description = "Ativa a nova configuração do Antonio OS (sem torná-la padrão de boot)";
      path = rebuildPath;
      serviceConfig.Type = "oneshot";
      script = ''
        systemctl stop antonio-revert.timer || true
        systemctl start antonio-revert.timer
        nixos-rebuild test --flake ${flakeRef}
      '';
    };

    systemd.services.antonio-confirm = {
      description = "Torna a configuração ativa do Antonio OS o novo padrão de boot";
      path = rebuildPath;
      serviceConfig.Type = "oneshot";
      script = ''
        systemctl stop antonio-revert.timer || true
        system=$(readlink -f /run/current-system)
        nix-env -p /nix/var/nix/profiles/system --set "$system"
        "$system/bin/switch-to-configuration" boot
      '';
    };

    systemd.services.antonio-revert = {
      description = "Volta à última configuração confirmada do Antonio OS";
      path = rebuildPath;
      serviceConfig.Type = "oneshot";
      script = ''
        systemctl stop antonio-revert.timer || true
        /nix/var/nix/profiles/system/bin/switch-to-configuration test
      '';
    };

    # Fires if nobody confirms (the agent died, the session froze, the network broke).
    systemd.timers.antonio-revert = {
      description = "Reversão automática de mudanças não confirmadas";
      timerConfig = { OnActiveSec = "${toString (cfg.confirmSeconds + 30)}s"; Unit = "antonio-revert.service"; };
    };

    security.polkit.extraConfig = ''
      polkit.addRule(function (action, subject) {
        if (action.id == "org.freedesktop.systemd1.manage-units" && subject.isInGroup("antonio")) {
          var unit = action.lookup("unit");
          var units = ["antonio-apply.service", "antonio-confirm.service", "antonio-revert.service"];
          if (units.indexOf(unit) >= 0 && action.lookup("verb") == "start") {
            return polkit.Result.YES;
          }
        }
      });
    '';
  };
}
