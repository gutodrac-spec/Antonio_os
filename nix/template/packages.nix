# Programas instalados no sistema. Para instalar algo, adicione o nome do pacote na lista.
{ pkgs, ... }:

{
  environment.systemPackages = with pkgs; [
    firefox
  ];
}
