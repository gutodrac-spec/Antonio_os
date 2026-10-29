# Antonio OS — Plano do Sistema

Sistema operacional baseado em Linux com o Claude integrado à área de trabalho:

1. **Barra lateral de chat própria** (não é um terminal) conversando com o Claude através do motor do Claude Code (Claude Agent SDK).
2. **O Claude pode modificar o próprio sistema** (pacotes, configurações, serviços, aparência), sempre com reversão segura.
3. **O Claude usa programas com mouse e teclado próprios**, numa área separada, **sem roubar o seu cursor, o seu foco ou o seu teclado**.

---

## 1. Decisões principais

| Tema | Decisão | Motivo |
|---|---|---|
| Base | **NixOS** (flake) | Configuração declarativa: toda mudança que o Claude faz vira um diff de texto, e cada versão do sistema vira uma "geração" que pode ser revertida no boot. É a base mais segura para um SO que se modifica sozinho. |
| Alternativa | Fedora Atomic (bootc) ou Arch + btrfs/snapper | Caso NixOS seja difícil demais para o usuário final. Mantemos a camada do agente independente da distro. |
| Servidor gráfico | **Wayland** com compositor **Sway** (wlroots) na fase 1; compositor próprio sobre wlroots/Smithay depois | Sway já suporta **múltiplos seats** (vários cursores/teclados independentes), saídas headless e os protocolos de entrada virtual que precisamos. |
| Motor do Claude | **Claude Agent SDK (TypeScript)** — o mesmo motor do Claude Code | Loop de agente, ferramentas, permissões, MCP, sessões e login já prontos. Autenticação com a conta Claude (assinatura) ou chave de API. |
| UI da barra lateral | **Tauri 2 (Rust + web)** como janela *layer-shell* fixa na lateral | UI moderna (React/Svelte), leve, reserva espaço na tela como um painel, não como janela comum. |
| Comunicação | Daemon local ↔ UI via **WebSocket em socket Unix** + **D-Bus** para eventos do sistema | Simples, local, sem expor porta de rede. |

---

## 2. Arquitetura

```
┌──────────────────────────── Sessão do usuário (Wayland / Sway) ────────────────────────────┐
│                                                                                            │
│   Seus apps (seat0: SEU mouse/teclado)                 │  Barra lateral "Antonio"          │
│                                                        │  (Tauri, layer-shell)             │
│                                                        │  • chat com streaming             │
│                                                        │  • prévia ao vivo da Área do      │
│                                                        │    Claude (PipeWire)              │
│                                                        │  • aprovar / negar ações          │
│                                                        │  • histórico e "desfazer"         │
└────────────────────────────────────────────────────────┴───────────────┬──────────────────┘
                                                                          │ WebSocket (unix socket)
                                                         ┌────────────────▼─────────────────┐
                                                         │  antonio-agentd (Node, usuário)  │
                                                         │  Claude Agent SDK                │
                                                         │  • sessões / memória             │
                                                         │  • política de permissões        │
                                                         │  • log de auditoria              │
                                                         └──┬──────────────┬───────────┬────┘
                                                MCP (stdio) │              │           │
                         ┌──────────────────────────────────▼──┐  ┌────────▼───────┐ ┌─▼──────────────────┐
                         │ antonio-desktop-mcp                 │  │ antonio-system │ │ ferramentas nativas│
                         │ (mouse/teclado/tela do Claude)      │  │ -mcp           │ │ do Claude Code     │
                         │ • screenshot da Área do Claude      │  │ • editar config│ │ (Read/Edit/Bash    │
                         │ • click / mover / arrastar / scroll │  │ • rebuild/test │ │  em sandbox)       │
                         │ • digitar / atalhos                 │  │ • rollback     │ └────────────────────┘
                         │ • árvore de acessibilidade (AT-SPI) │  │ • serviços     │
                         │ • abrir/fechar apps                 │  └───────┬────────┘
                         └──────────────┬──────────────────────┘          │ polkit
                                        │ virtual-pointer/keyboard        ▼
                         ┌──────────────▼──────────────────────┐  ┌──────────────────────┐
                         │ "Área do Claude"                    │  │ antonio-privileged   │
                         │ saída headless do compositor        │  │ (root, mínimo):      │
                         │ + seat próprio (cursor do Claude)   │  │ nixos-rebuild,       │
                         └─────────────────────────────────────┘  │ rollback, systemctl  │
                                                                  └──────────────────────┘
```

### Componentes

| Componente | Linguagem | Papel |
|---|---|---|
| `antonio-agentd` | TypeScript (Node) | Hospeda o Claude Agent SDK, gerencia conversas, aplica a política de permissões, registra auditoria, fala com a UI. Roda como serviço systemd do usuário. |
| `antonio-sidebar` | Tauri (Rust + Svelte) | Barra lateral: chat, cartões de aprovação, prévia ao vivo da Área do Claude, botão "assumir controle", histórico de mudanças com "desfazer". |
| `antonio-desktop-mcp` | Rust | Servidor MCP com as ferramentas de computador (tela, mouse, teclado, acessibilidade). |
| `antonio-system-mcp` | TypeScript | Servidor MCP com as ferramentas de modificação do sistema. Nunca roda como root. |
| `antonio-privileged` | Rust | Helper root mínimo via D-Bus + polkit; aceita só um conjunto fixo de comandos (rebuild, rollback, reiniciar serviço). |
| `antonio-compositor` | config do Sway (fase 1) → compositor próprio (fase 5) | Seats separados, saída headless do Claude, regras de janela. |
| `nix/` | Nix | Flake com módulos NixOS, pacotes, imagem ISO e VM de teste. |

---

## 3. O problema central: o Claude usar mouse e teclado sem atrapalhar você

O mouse/teclado do Linux são normalmente únicos por sessão. A solução é dar ao Claude **um seat próprio** e **uma tela própria**.

### 3.1 Modo padrão — "Área do Claude" (tela invisível separada)

- O compositor cria uma **saída headless** (monitor virtual, ex.: 1920×1080) que não aparece nos seus monitores.
- O Claude recebe um **seat separado** (`seat-claude`) com ponteiro e teclado **virtuais** (protocolos `zwlr_virtual_pointer_v1` e `zwp_virtual_keyboard_v1`, ou `libei`).
- Apps que o Claude abre são lançados nessa saída. Foco, cursor e digitação ficam só lá → **seu cursor e seu foco nunca se movem**.
- A tela do Claude é capturada (protocolo `wlr-screencopy` / PipeWire) e:
  - enviada ao modelo como screenshot quando ele precisa "ver";
  - exibida ao vivo, em miniatura, na barra lateral para você acompanhar.
- **Mesmos programas, mesmos arquivos**: os apps rodam com o seu usuário, então o Claude usa seu navegador, seus documentos etc.
- **Passar janelas**: como é o mesmo compositor, uma janela pode ser movida da Área do Claude para sua área de trabalho (e vice-versa) com um clique — "trazer para mim" / "entregar ao Claude".

### 3.2 Modo "lado a lado" (fase posterior)

- O Claude trabalha numa janela visível na sua tela usando o **segundo cursor** (seat próprio), com cor e rótulo diferentes.
- Limitação conhecida: apps X11 (via XWayland) e alguns apps Wayland só lidam bem com um seat. Por isso esse modo é opcional e o modo padrão é a Área separada.

### 3.3 Controle semântico antes de pixels

Para ser mais rápido e confiável que "clicar em coordenadas":

1. **AT-SPI (acessibilidade)**: ler a árvore de botões/campos e acionar elementos por nome.
2. **APIs diretas** quando existirem: D-Bus do app, CLI, DevTools do navegador (CDP).
3. **Pixels** (screenshot + click/teclado) como último recurso universal.

### 3.4 Ferramentas expostas pelo `antonio-desktop-mcp`

`screenshot`, `click(x,y,botão)`, `move`, `drag`, `scroll`, `type(texto)`, `key(combo)`, `launch_app(nome)`, `list_windows`, `focus_window`, `close_window`, `a11y_tree(janela)`, `a11y_action(elemento, ação)`, `handoff_window(para: usuário|claude)`.

Todas atuam **somente** no seat/saída do Claude. Tentativas de atuar na sua área exigem aprovação explícita.

---

## 4. O Claude modificando o próprio sistema

### 4.1 Onde as mudanças moram

```
/etc/antonio/            ← repositório git (flake do sistema)
├── flake.nix
├── system/              ← módulos editáveis pelo Claude (pacotes, serviços, hardware)
├── user/                ← home-manager: dotfiles, tema, atalhos, apps do usuário
└── antonio/             ← configuração do próprio Antonio OS (sidebar, compositor, políticas)
```

### 4.2 Ciclo de uma mudança

1. Claude edita arquivos do flake (ferramentas Edit nativas, restritas a `/etc/antonio`).
2. `antonio-system-mcp` valida: `nix flake check` + build (`nixos-rebuild build`).
3. Barra lateral mostra **cartão de aprovação** com o diff e o resumo ("instalar GIMP, ativar Bluetooth").
4. Aprovado → `antonio-privileged` executa `nixos-rebuild test` (aplica sem tornar padrão de boot).
5. **Temporizador de confirmação** (estilo "manter essas configurações de tela?"): se você não confirmar em 60 s, ou se a sessão gráfica/rede quebrar, reverte automaticamente.
6. Confirmado → `nixos-rebuild switch` + commit git com mensagem gerada.
7. "Desfazer" na barra lateral = `git revert` + rebuild; e no boot sempre há as gerações anteriores.

### 4.3 Tipos de mudança e nível de permissão

| Nível | Exemplos | Padrão |
|---|---|---|
| 0 — Leitura | ler logs, status, configs, listar apps | automático |
| 1 — Usuário | tema, papel de parede, atalhos, dotfiles, instalar app do usuário (home-manager/Flatpak) | automático com log, desfazível |
| 2 — Sistema | pacotes do sistema, serviços, rede, drivers | **aprovação na barra lateral** |
| 3 — Crítico | bootloader, kernel, discos, usuários, firewall, o próprio Antonio | aprovação + confirmação digitada/senha |

Também pode **modificar a si mesmo**: a sidebar e o compositor são pacotes do flake; o Claude pode editar seus fontes em `/etc/antonio/antonio/` e reconstruir — com o mesmo ciclo de teste e rollback.

---

## 5. Segurança

- `antonio-agentd` roda como seu usuário, **sem root**. Root só pelo helper `antonio-privileged`, com lista fixa de comandos e polkit.
- Ferramenta Bash do Claude roda em **sandbox** (bubblewrap) com acesso restrito; comandos fora da política pedem aprovação.
- **Log de auditoria** imutável de toda ação (`~/.local/state/antonio/audit.jsonl`), visível na barra lateral.
- **Botão de pânico** (atalho global, ex.: `Super+Esc`): pausa o agente, congela o seat do Claude e cancela mudanças pendentes.
- Áreas sensíveis bloqueadas por padrão: gerenciador de senhas, chaves SSH/GPG, banco; conteúdo de páginas web e arquivos é tratado como dado, não como instrução (proteção contra *prompt injection*).
- Credencial do Claude guardada no keyring do sistema (Secret Service), nunca em texto puro.

---

## 6. Experiência do usuário

- **Primeiro boot**: instalador gráfico → login na conta Claude (OAuth do Claude Code) ou chave de API → tour rápido.
- **Barra lateral** (`Super+Space` abre/recolhe): chat com streaming, anexar arquivos/screenshots, comandos rápidos ("organize minhas janelas", "instale o Spotify").
- **Prévia ao vivo** da Área do Claude com botões: *assumir controle*, *trazer janela para mim*, *pausar*.
- **Cartões de aprovação** com diff legível e botões Aprovar / Negar / Sempre permitir isso.
- **Linha do tempo** de mudanças do sistema com "desfazer" em um clique.
- Idioma padrão: português do Brasil.

---

## 7. Estrutura do repositório

```
antonio_os/
├── PLAN.md
├── flake.nix                 # entrada: pacotes, módulos, ISO, VM de teste
├── nix/
│   ├── modules/              # antonio.nix, compositor.nix, agent.nix, security.nix
│   ├── packages/
│   └── iso.nix
├── agentd/                   # antonio-agentd (TypeScript + Claude Agent SDK)
├── sidebar/                  # antonio-sidebar (Tauri + Svelte)
├── mcp/
│   ├── desktop/              # antonio-desktop-mcp (Rust)
│   └── system/               # antonio-system-mcp (TypeScript)
├── privileged/               # antonio-privileged (Rust, D-Bus + polkit)
├── compositor/               # config Sway (fase 1) / compositor próprio (fase 5)
├── tests/                    # testes NixOS em VM (nixosTest) e e2e
└── docs/
```

---

## 8. Fases de desenvolvimento

### Fase 0 — Fundação (1–2 semanas)
- Flake NixOS com Sway, gerando **VM QEMU** e **ISO** inicial.
- CI (GitHub Actions) construindo a VM e rodando `nixosTest`.
- **Entrega:** ISO que dá boot num desktop Sway com o tema base.

### Fase 1 — Chat na barra lateral (2–3 semanas)
- `antonio-agentd` com Claude Agent SDK, login, streaming, histórico de sessões.
- `antonio-sidebar` em Tauri como painel layer-shell.
- Só ferramentas de leitura (nível 0).
- **Entrega:** conversar com o Claude pela barra lateral e pedir informações do sistema.

### Fase 2 — O Claude modifica o sistema (3–4 semanas)
- `/etc/antonio` como repositório git; `antonio-system-mcp`; `antonio-privileged`.
- Cartões de aprovação, `nixos-rebuild test` + confirmação com rollback automático, linha do tempo/desfazer.
- **Entrega:** "instale o VLC e mude o tema para escuro" funciona, com aprovação e desfazer.

### Fase 3 — Área do Claude: mouse e teclado próprios (4–6 semanas)
- Saída headless + `seat-claude` + entrada virtual no Sway.
- `antonio-desktop-mcp` com screenshot, mouse, teclado, lançar apps.
- Prévia ao vivo via PipeWire na sidebar; botão de pânico.
- Teste automático: o Claude digita num editor enquanto um script simula o usuário digitando em outro — nenhum caractere pode vazar entre os dois.
- **Entrega:** "abra o LibreOffice e monte uma planilha" acontece em paralelo sem tocar no seu cursor.

### Fase 4 — Controle semântico e transferência de janelas (3–4 semanas)
- AT-SPI, integração com navegador (CDP), D-Bus de apps.
- "Trazer janela para mim" / "entregar ao Claude".
- **Entrega:** tarefas em apps comuns mais rápidas e confiáveis que só por pixels.

### Fase 5 — Polimento e identidade própria (contínuo)
- Compositor próprio (wlroots/Smithay) com a Área do Claude e o modo "lado a lado" (segundo cursor) nativos.
- Instalador gráfico, onboarding, tema/ícones próprios, atualizações automáticas.
- Auto-modificação da própria UI (Claude editando a sidebar e reconstruindo).

---

## 9. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Mudança do Claude quebra o boot ou a sessão | `nixos-rebuild test` + temporizador de rollback + gerações no boot + testes em VM antes. |
| Apps não lidam bem com múltiplos seats | Modo padrão usa saída separada (um app só vê o seat do Claude); modo lado a lado é opcional. |
| Custo/latência de screenshots | Priorizar AT-SPI e APIs; screenshots reduzidos e só quando necessário. |
| *Prompt injection* via páginas/arquivos | Conteúdo externo como dado, aprovação para níveis 2–3, áreas sensíveis bloqueadas, auditoria. |
| Curva de aprendizado do NixOS | O usuário não precisa ver Nix: o Claude e a UI fazem a ponte; alternativa Fedora Atomic documentada. |
| Uso intenso de recursos | Saída headless só ativa quando o Claude está usando o computador; resolução configurável. |

---

## 10. Perguntas em aberto (para decidir antes da Fase 0)

1. **Base**: NixOS (recomendado) ou prefere algo mais tradicional como Fedora/Arch?
2. **Hardware alvo**: PC próprio (qual GPU?), notebook, ou primeiro só VM?
3. **Conta**: usar login da assinatura Claude ou chave de API?
4. **Nível de autonomia padrão**: aprovar toda mudança de sistema, ou permitir mais coisas automaticamente?
5. **Visual**: alguma referência de estilo (macOS, GNOME, Windows 11, algo próprio)?
