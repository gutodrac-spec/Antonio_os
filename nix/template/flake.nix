{
  description = "Configuração do Antonio OS desta máquina — editável pelo Claude, com histórico no git";

  inputs.antonio-os.url = "path:@source@";

  outputs = { antonio-os, ... }: {
    nixosConfigurations.antonio = antonio-os.lib.mkSystem {
      modules = [
        ./hardware-configuration.nix
        ./configuration.nix
        ./packages.nix
      ];
    };
  };
}
