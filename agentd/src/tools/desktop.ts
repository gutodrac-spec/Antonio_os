import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ClaudeDesktop } from "../claudeDesktop.js";
import { textResult } from "../util.js";

const coord = z.number().int().min(0).max(10000);

async function guard(fn: () => Promise<string>) {
  try {
    return textResult(await fn());
  } catch (e) {
    return textResult(String(e instanceof Error ? e.message : e), true);
  }
}

/** Tools that act only on Claude's own desktop (its separate compositor and seat). */
export function desktopServer(desk: ClaudeDesktop) {
  return createSdkMcpServer({
    name: "desktop",
    version: "0.1.0",
    instructions:
      "Estas ferramentas controlam a Área do Claude: uma tela separada, com mouse e teclado próprios, " +
      "que nunca interfere no cursor, no foco ou na digitação do usuário. Coordenadas em pixels da captura (scale 1).",
    tools: [
      tool("screenshot", "Captura a tela da Área do Claude. Use antes de clicar para saber onde estão os elementos.", {
        scale: z.number().min(0.25).max(1).optional().describe("Fator de redução (1 = resolução real)."),
      }, async ({ scale }) => {
        try {
          const img = await desk.screenshot({ scale: scale ?? 1 });
          const windows = await desk.windows();
          return {
            content: [
              { type: "image" as const, data: img.toString("base64"), mimeType: "image/jpeg" },
              { type: "text" as const, text: `Janelas: ${JSON.stringify(windows)}` },
            ],
          };
        } catch (e) {
          return textResult(String(e instanceof Error ? e.message : e), true);
        }
      }, { annotations: { readOnlyHint: true } }),

      tool("click", "Clica na Área do Claude.", {
        x: coord, y: coord,
        button: z.enum(["left", "right", "middle"]).optional(),
        count: z.number().int().min(1).max(3).optional().describe("2 para clique duplo."),
      }, ({ x, y, button, count }) => guard(async () => {
        await desk.click(x, y, button ?? "left", count ?? 1);
        return `Clique em (${x}, ${y}).`;
      })),

      tool("move_mouse", "Move o cursor do Claude (por exemplo, para hover).", { x: coord, y: coord },
        ({ x, y }) => guard(async () => { await desk.moveTo(x, y); return `Cursor em (${x}, ${y}).`; })),

      tool("drag", "Arrasta com o botão esquerdo de um ponto a outro.", {
        from_x: coord, from_y: coord, to_x: coord, to_y: coord,
      }, (a) => guard(async () => {
        await desk.drag(a.from_x, a.from_y, a.to_x, a.to_y);
        return "Arraste concluído.";
      })),

      tool("scroll", "Rola a roda do mouse sobre um ponto.", {
        x: coord, y: coord,
        direction: z.enum(["up", "down", "left", "right"]),
        amount: z.number().int().min(1).max(30).optional(),
      }, ({ x, y, direction, amount }) => guard(async () => {
        await desk.scroll(x, y, direction, amount ?? 3);
        return "Rolagem concluída.";
      })),

      tool("type_text", "Digita texto na janela focada da Área do Claude.", { text: z.string().min(1).max(20000) },
        ({ text }) => guard(async () => { await desk.type(text); return `Digitado ${text.length} caracteres.`; })),

      tool("key", "Pressiona uma tecla ou combinação, ex.: 'enter', 'ctrl+l', 'ctrl+shift+t', 'alt+f4'.", {
        combo: z.string().min(1).max(64),
      }, ({ combo }) => guard(async () => { await desk.key(combo); return `Tecla ${combo}.`; })),

      tool("launch_app", "Abre um programa na Área do Claude (comando de shell, ex.: 'firefox https://exemplo.com').", {
        command: z.string().min(1).max(2000),
      }, ({ command }) => guard(async () => {
        const pid = desk.launch(command);
        await new Promise((r) => setTimeout(r, 1500));
        return `Iniciado (pid ${pid}). Faça uma captura de tela para ver o resultado.`;
      })),

      tool("list_windows", "Lista as janelas abertas na Área do Claude.", {},
        () => guard(async () => JSON.stringify(await desk.windows(), null, 2)), { annotations: { readOnlyHint: true } }),

      tool("window_action", "Age sobre uma janela da Área do Claude pelo id de list_windows.", {
        id: z.number().int(),
        action: z.enum(["focus", "close", "fullscreen", "floating"]),
      }, ({ id, action }) => guard(async () => {
        const cmd = { focus: "focus", close: "kill", fullscreen: "fullscreen toggle", floating: "floating toggle" }[action];
        await desk.swaymsg(`[con_id=${id}] ${cmd}`);
        return `Janela ${id}: ${action}.`;
      })),
    ],
  });
}
