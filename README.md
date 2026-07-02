# Omarchy Scripts

Scripts pessoais para Omarchy/Hyprland. O repositório mantém os comandos em `src/`, o mapa de atalhos em `src/manifest.tsv` e automação de instalação em `scripts/`.

Os exemplos usam `~/projects/omarchy-scripts`, mas os scripts de instalação resolvem o caminho real do clone atual.

## Instalação

| Comando | Ação |
| --- | --- |
| `./scripts/install` | Instala todos os scripts do manifest e adiciona os keybindings gerenciados em `~/.config/hypr/bindings.conf`. |
| `./scripts/uninstall` | Remove todos os keybindings gerenciados por este repositório de `~/.config/hypr/bindings.conf`. |

O bloco instalado fica entre:

```hyprlang
# BEGIN omarchy-scripts
# END omarchy-scripts
```

Para alterar atalhos, edite `src/manifest.tsv` e rode `./scripts/install` novamente.

## Comandos

| Titulo | Descricao | Comando | Atalho | Script | Dependencias |
| --- | --- | --- | --- | --- | --- |
| Active window screenshot | Captura a janela ativa, salva em Pictures, copia para o clipboard e mostra uma notificacao com o caminho salvo. | `./src/omarchy-capture-active-window` | `Super+Shift+Print` | [`src/omarchy-capture-active-window`](src/omarchy-capture-active-window) | `hyprctl`, `jq`, `grim`, `wl-copy`, `notify-send` |
| Main + side stack layout | Alterna a workspace atual entre `dwindle` e `master`, usando a janela focada como painel principal e empilhando as outras a direita. | `./src/omarchy-layout-main-two-stack` | `Super+Alt+L` | [`src/omarchy-layout-main-two-stack`](src/omarchy-layout-main-two-stack) | `hyprctl`, `jq`, `notify-send` |

## Dependencias

| Dependencia | Uso |
| --- | --- |
| `hyprctl` | Ler estado do Hyprland, alterar layout da workspace e recarregar keybindings. |
| `jq` | Validar e extrair campos de JSON retornado pelo `hyprctl`. |
| `notify-send` | Exibir notificacoes de sucesso ou erro. |
| `grim` | Capturar imagem da janela ativa. |
| `wl-copy` | Copiar screenshot para o clipboard. |

## Manifest

`src/manifest.tsv` usa uma linha por comando:

| Campo | Descricao |
| --- | --- |
| `script` | Nome do arquivo executavel dentro de `src/`. |
| `title` | Texto exibido na descricao do keybinding Hyprland. |
| `description` | Descricao humana usada por docs e manutencao. |
| `modifiers` | Modificadores do bind, como `SUPER SHIFT`. |
| `key` | Tecla do bind, como `PRINT` ou `L`. |
| `dependencies` | Dependencias separadas por virgula. |

## Seguranca

Os scripts nao usam `sudo`, nao removem arquivos persistentes e nao alteram servicos do sistema.

| Script | Efeito colateral |
| --- | --- |
| [`src/omarchy-capture-active-window`](src/omarchy-capture-active-window) | Cria um PNG no diretorio de imagens e substitui o conteudo atual do clipboard. |
| [`src/omarchy-layout-main-two-stack`](src/omarchy-layout-main-two-stack) | Muda o layout da workspace ativa. Ele forca `general:layout dwindle` antes de aplicar `layout:master` por workspace para evitar vazamento global do layout `master`. |
| [`scripts/install`](scripts/install) | Faz backup de `~/.config/hypr/bindings.conf`, atualiza o bloco gerenciado e recarrega Hyprland quando `hyprctl` esta disponivel. |
| [`scripts/uninstall`](scripts/uninstall) | Faz backup de `~/.config/hypr/bindings.conf`, remove o bloco gerenciado e recarrega Hyprland quando `hyprctl` esta disponivel. |

## Validacao

```bash
bash -n src/omarchy-capture-active-window
bash -n src/omarchy-layout-main-two-stack
bash -n scripts/install
bash -n scripts/uninstall
./scripts/install
hyprctl configerrors
```
