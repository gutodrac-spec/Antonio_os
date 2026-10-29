# Perfil do sistema ao vivo (pendrive).
{ modulesPath, ... }:

{
  imports = [ (modulesPath + "/installer/cd-dvd/installation-cd-graphical-base.nix") ];
  antonio.autoLogin = true;
  antonio.seed.profile = "iso";
}
