{ lib, stdenvNoCC, python3, wrapGAppsHook3, gobject-introspection, gtk3, gtk-layer-shell, webkitgtk_4_1, glib-networking }:

let
  python = python3.withPackages (p: [ p.pygobject3 ]);
in
stdenvNoCC.mkDerivation {
  pname = "antonio-sidebar";
  version = "0.1.0";
  src = lib.cleanSource ../../sidebar;

  nativeBuildInputs = [ wrapGAppsHook3 gobject-introspection ];
  buildInputs = [ python gtk3 gtk-layer-shell webkitgtk_4_1 glib-networking ];

  installPhase = ''
    runHook preInstall
    install -Dm755 antonio-sidebar.py $out/bin/antonio-sidebar
    substituteInPlace $out/bin/antonio-sidebar --replace-fail "#!/usr/bin/env python3" "#!${python.interpreter}"
    mkdir -p $out/share/antonio
    cp -r web $out/share/antonio/web
    runHook postInstall
  '';

  meta = {
    description = "Antonio OS sidebar (layer-shell panel hosting the chat UI)";
    mainProgram = "antonio-sidebar";
    license = lib.licenses.mit;
  };
}
