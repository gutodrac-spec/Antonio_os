{
  description = "Antonio OS — Linux (NixOS) com o Claude integrado na área de trabalho";

  inputs.nixpkgs.url = "https://channels.nixos.org/nixos-unstable/nixexprs.tar.xz";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };
      antonioPkgs = import ./nix/packages { inherit pkgs; };

      mkSystem = { modules, system ? "x86_64-linux" }:
        nixpkgs.lib.nixosSystem {
          inherit system;
          specialArgs = { antonioSource = self; inherit nixpkgs; };
          modules = [ self.nixosModules.default ] ++ modules;
        };
    in
    {
      lib = { inherit mkSystem; };

      nixosModules.default = import ./nix/modules/antonio.nix;

      packages.${system} = antonioPkgs // {
        default = antonioPkgs.antonio-agentd;
        vm = self.nixosConfigurations.vm.config.system.build.vm;
        iso = self.nixosConfigurations.iso.config.system.build.isoImage;
      };

      nixosConfigurations = {
        vm = mkSystem { modules = [ ./nix/hosts/vm.nix ]; };
        iso = mkSystem { modules = [ ./nix/hosts/iso.nix ]; };
      };

      checks.${system} = {
        agentd = antonioPkgs.antonio-agentd;
        sidebar = antonioPkgs.antonio-sidebar;
        vm-toplevel = self.nixosConfigurations.vm.config.system.build.toplevel;
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = (with pkgs; [ nodejs_22 sway grim wtype foot jq git ]) ++ [ antonioPkgs.antonio-sidebar ];
      };
    };
}
