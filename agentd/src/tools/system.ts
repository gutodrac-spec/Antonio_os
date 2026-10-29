import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import { z } from "zod";
import type { Hub } from "../hub.js";
import { config } from "../config.js";
import * as sys from "../system.js";
import { textResult } from "../util.js";

export function systemServer(hub: Hub) {
  return createSdkMcpServer({
    name: "system",
    version: "0.1.0",
    instructions:
      `O sistema é NixOS declarativo. Toda a configuração editável está no repositório git ${config.configRepo} ` +
      `(flake com nixosConfigurations.${config.flakeHost}). Para mudar o sistema: edite os arquivos ali, ` +
      "depois chame system apply com um resumo curto em português. Nunca rode nixos-rebuild ou sudo pelo Bash.",
    tools: [
      tool("status", "Resumo do sistema: versão, serviços com falha, disco, memória e estado da configuração.", {},
        async () => textResult(await sys.systemStatus()), { annotations: { readOnlyHint: true } }),

      tool("config_diff", `Mostra as mudanças ainda não aplicadas em ${config.configRepo}.`, {},
        async () => textResult((await sys.configDiff()) || "(sem mudanças)"), { annotations: { readOnlyHint: true } }),

      tool("build", "Compila a configuração atual sem ativar, para checar erros.", {}, async () => {
        const b = await sys.build();
        return textResult(b.ok ? `Compilou.\n${b.output}` : `Falhou.\n${b.output}`, !b.ok);
      }),

      tool("apply", "Compila, pede aprovação ao usuário (com o diff), ativa a nova configuração e espera a confirmação; " +
        "sem confirmação o sistema é revertido sozinho. Retorna o resultado.", {
        summary: z.string().min(3).max(200).describe("Resumo da mudança, ex.: 'Instalar o GIMP e ativar Bluetooth'."),
      }, async ({ summary }) => {
        const r = await sys.applyChange(hub, summary);
        return textResult(r.message, r.status !== "kept");
      }),

      tool("history", "Lista as mudanças do sistema já aplicadas (git log).", {
        limit: z.number().int().min(1).max(200).optional(),
      }, async ({ limit }) => textResult(await sys.history(limit)), { annotations: { readOnlyHint: true } }),

      tool("undo", "Desfaz uma mudança aplicada (padrão: a última), com o mesmo ciclo de aprovação e confirmação.", {
        commit: z.string().regex(/^[0-9a-fA-F]{4,40}$|^HEAD(~\d+)?$/).optional(),
      }, async ({ commit }) => {
        const r = await sys.undo(hub, commit);
        return textResult(r.message, r.status !== "kept");
      }),

      tool("user_desktop", "Envia um comando swaymsg para a área de trabalho DO USUÁRIO (papel de parede, layout, mover janelas). " +
        "Interfere no que ele está vendo: use só quando ele pedir. Exige aprovação.", {
        command: z.string().min(1).max(500),
      }, async ({ command }) => textResult(await sys.userSway(command))),

      tool("open_for_user", "Abre um programa na tela DO USUÁRIO (por exemplo, para entregar um resultado). Exige aprovação.", {
        command: z.string().min(1).max(2000),
      }, async ({ command }) => {
        const child = spawn("sh", ["-c", command], { detached: true, stdio: "ignore" });
        child.unref();
        return textResult(`Aberto na tela do usuário (pid ${child.pid}).`);
      }),
    ],
  });
}
