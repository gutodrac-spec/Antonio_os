{ pkgs }:
rec {
  antonio-agentd = pkgs.callPackage ./agentd.nix { };
  antonio-sidebar = pkgs.callPackage ./sidebar.nix { };
  antonio-claude-desktop = pkgs.callPackage ./claude-desktop.nix { };
  antonio-ctl = pkgs.callPackage ./ctl.nix { };
}
