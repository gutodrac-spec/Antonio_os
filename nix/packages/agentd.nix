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

  # The SDK's bundled Claude Code binaries are prebuilt for FHS systems; Antonio OS
  # points the SDK at nixpkgs' claude-code instead (ANTONIO_CLAUDE_BIN).
  postInstall = ''
    rm -rf $out/lib/node_modules/antonio-agentd/node_modules/@anthropic-ai/claude-agent-sdk-linux-*
    rm -rf $out/lib/node_modules/antonio-agentd/dist/test
  '';

  meta = {
    description = "Antonio OS agent daemon (Claude Agent SDK host)";
    mainProgram = "antonio-agentd";
    license = lib.licenses.mit;
  };
}
