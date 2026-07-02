# Omarchy Scripts

Scripts pessoais para Omarchy/Hyprland. Os comandos ficam em `src/`, os atalhos ficam em `src/manifest.tsv`, e a instalação gera o bloco de keybindings em `~/.config/hypr/bindings.conf`.

## Instalação

Clone o repositório, entre na pasta e execute o instalador:

```bash
git clone git@github.com:<user>/omarchy-scripts.git ~/projects/omarchy-scripts
cd ~/projects/omarchy-scripts
./scripts/install
```

## Desinstalação

Execute o desinstalador:

```bash
cd ~/projects/omarchy-scripts
./scripts/uninstall
```

## Comandos

| Título | Descrição | Atalho | Script | Dependências |
| --- | --- | --- | --- | --- |
| Active window screenshot | Captura a janela ativa, salva em Pictures, copia para o clipboard e mostra uma notificação com o caminho salvo. | `Super+Shift+Print` | [omarchy-capture-active-window](src/omarchy-capture-active-window) | [hyprctl](https://wiki.hypr.land/Configuring/Using-hyprctl/), [jq](https://jqlang.org/), [grim](https://man.archlinux.org/man/grim.1.en), [wl-copy](https://man.archlinux.org/man/wl-copy.1.en), [notify-send](https://man.archlinux.org/man/notify-send.1.en) |
| Main + side stack layout | Alterna a workspace atual entre `dwindle` e `master`, usando a janela focada como painel principal e empilhando as outras à direita. | `Super+Alt+L` | [omarchy-layout-main-two-stack](src/omarchy-layout-main-two-stack) | [hyprctl](https://wiki.hypr.land/Configuring/Using-hyprctl/), [jq](https://jqlang.org/), [notify-send](https://man.archlinux.org/man/notify-send.1.en) |
