# Máquina virtual de demonstração: `nix run .#vm`.
{ modulesPath, ... }:

{
  imports = [ (modulesPath + "/virtualisation/qemu-vm.nix") ];
  antonio = { enable = true; user = "antonio"; autoLogin = true; seed.profile = "vm"; };
  networking.hostName = "antonio";
  time.timeZone = "America/Sao_Paulo";
  i18n.defaultLocale = "pt_BR.UTF-8";
  console.keyMap = "br-abnt2";
  users.users.antonio = {
    isNormalUser = true;
    initialPassword = "antonio";
    extraGroups = [ "wheel" "networkmanager" "video" "audio" ];
  };
  virtualisation = { memorySize = 4096; cores = 4; diskSize = 20480; resolution = { x = 1600; y = 900; }; };
  system.stateVersion = "25.11";
}
