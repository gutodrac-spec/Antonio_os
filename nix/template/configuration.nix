# Configuração principal do Antonio OS.
# O Claude edita estes arquivos e aplica com aprovação; cada mudança vira um commit.
{ pkgs, ... }:

{
  imports = [ ./profile-@profile@.nix ];

  antonio = {
    enable = true;
    user = "@user@";
  };

  networking.hostName = "antonio";
  time.timeZone = "America/Sao_Paulo";
  i18n.defaultLocale = "pt_BR.UTF-8";
  console.keyMap = "br-abnt2";

  users.users."@user@" = {
    isNormalUser = true;
    extraGroups = [ "wheel" "networkmanager" "video" "audio" ];
  };

  system.stateVersion = "25.11";
}
