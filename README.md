# Antonio OS

Sistema operacional baseado em Linux (NixOS + Sway) com o Claude integrado:

- **Barra lateral de chat própria** (`Super+Espaço`), conversando com o Claude pelo motor do Claude Code (Claude Agent SDK).
- **O Claude modifica o próprio sistema**: edita a configuração em `/etc/antonio`, você aprova o diff, o sistema aplica e, se você não confirmar em 60 s, **volta sozinho** à versão anterior. Cada mudança vira um commit com "desfazer".
- **O Claude usa programas com mouse e teclado próprios**, na "Área do Claude", um compositor separado e invisível. **Seu cursor, seu foco e sua digitação nunca são tocados.** Você acompanha a tela dele ao vivo pela barra lateral.
- **Botão de pânico** (`Super+Esc` ou o botão ■) para parar tudo na hora.

O plano completo e o estado da implementação estão em [PLAN.md](PLAN.md).

## Experimentar

Precisa de Nix com flakes.

```sh
# Máquina virtual (login automático; usuário antonio / senha antonio)
nix run .#vm

# Imagem ISO (VirtualBox, VMware, QEMU ou pendrive)
nix build .#iso   # resultado: result/iso/antonio-os.iso
```

Sem Nix: em **Actions → ISO → Run workflow** no GitHub, o arquivo `antonio-os.iso` fica disponível para download ao fim da execução.

Para usar a ISO numa máquina virtual: 4 GB de RAM ou mais, 2+ CPUs, vídeo virtio ou VMSVGA e boot UEFI ou BIOS. O sistema entra direto na área de trabalho (usuário `nixos`).
O Claude Code exige um processador com AVX2: no QEMU/virt-manager use `-cpu host` (ou "copiar configuração da CPU do host"); VirtualBox e VMware já repassam por padrão.

No primeiro uso, abra as configurações da barra lateral (⚙) e clique em **Entrar com a conta Claude** ou cole uma chave de API.

### Desenvolvimento em qualquer Linux

```sh
nix develop
(cd agentd && npm ci && npm run build && npm test)
scripts/dev-session.sh            # aninhado na sua sessão Wayland
scripts/dev-session.sh --headless # sem tela, para testes
```

No modo de desenvolvimento as mudanças no sistema rodam em modo de teste (`ANTONIO_DRY_RUN_SYSTEM=1`): o fluxo de aprovação e o git funcionam, mas nada é aplicado de verdade.

## Estrutura

| Pasta | O que é |
|---|---|
| `agentd/` | `antonio-agentd`: hospeda o Claude (Agent SDK), política de permissões, auditoria e as ferramentas `desktop` (Área do Claude) e `system` (mudanças com reversão). |
| `sidebar/` | Barra lateral: interface web (`web/`) dentro de uma janela GTK *layer-shell* que reserva espaço na lateral da tela. |
| `nix/modules/antonio.nix` | Módulo NixOS: sessão Sway, serviços, unidades de aplicar/confirmar/reverter, regra polkit. |
| `nix/packages/` | Pacotes Nix, incluindo o compositor headless da Área do Claude. |
| `nix/template/` | Configuração inicial copiada para `/etc/antonio` no primeiro boot (é ela que o Claude edita). |
| `nix/hosts/` | Configurações da VM e da ISO. |

## Permissões

| Nível | Exemplos | Comportamento |
|---|---|---|
| 0 — leitura | ler arquivos, status, comandos só de leitura, usar a Área do Claude | automático |
| 1 — usuário | editar `/etc/antonio` e `~/Antonio`; mexer na **sua** tela | automático ou com aprovação, sempre auditado |
| 2 — sistema | aplicar mudança no sistema, comandos que alteram coisas | aprovação na barra lateral |
| 3 — crítico | `sudo`, `rm -rf`, discos, chaves | aprovação, sem opção "sempre permitir" |

Chaves SSH/GPG, senhas e credenciais ficam bloqueadas. Todo o histórico fica em `~/.local/state/antonio/audit.jsonl`.
