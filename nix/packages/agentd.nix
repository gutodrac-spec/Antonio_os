{ lib, buildNpmPackage, nodejs_22, git }:

buildNpmPackage {
  pname = "antonio-agentd";
  version = "0.1.0";
  src = lib.cleanSource ../../agentd;
  nodejs = nodejs_22;
  nativeCheckInputs = [ git ];
  npmDepsHash = "sha256-sANtZ/iZ0hHhD7C9ANw7Zht5+67L7BBr6nasVidZtNs=";

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    ANTONIO_STATE_DIR=$TMPDIR/state npm test
    runHook postCheck
  '';

  # The SDK ships Claude Code as a single-file executable that reads its own
  # payload: it must not be stripped or patched. It runs on NixOS through nix-ld.
  dontStrip = true;
  dontPatchELF = true;
  postInstall = ''
    lib=$out/lib/node_modules/antonio-agentd
    rm -rf $lib/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl $lib/dist/test
    ln -s $lib/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude $out/bin/claude
  '';

  meta = {
    description = "Antonio OS agent daemon (Claude Agent SDK host)";
    mainProgram = "antonio-agentd";
    license = lib.licenses.mit;
  };
}
