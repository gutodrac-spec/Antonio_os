# Sistema ao vivo para pendrive: `nix build .#iso`.
{ modulesPath, lib, ... }:

{
  imports = [ (modulesPath + "/installer/cd-dvd/installation-cd-graphical-base.nix") ];
  antonio = { enable = true; user = "nixos"; autoLogin = true; seed.profile = "iso"; };
  image.baseName = lib.mkForce "antonio-os";
  networking.hostName = "antonio";
  time.timeZone = "America/Sao_Paulo";
  i18n.defaultLocale = "pt_BR.UTF-8";
  console.keyMap = "br-abnt2";
}
