# Perfil da máquina virtual de demonstração.
{ modulesPath, ... }:

{
  imports = [ (modulesPath + "/virtualisation/qemu-vm.nix") ];
  antonio.autoLogin = true;
  antonio.seed.profile = "vm";
  virtualisation = { memorySize = 4096; cores = 4; diskSize = 20480; };
  users.users."@user@".initialPassword = "antonio";
}
