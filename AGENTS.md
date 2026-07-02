# AGENTS.md

## Escopo

Este repositório guarda scripts pessoais usados por Omarchy/Hyprland.

## Estrutura

- Scripts executáveis ficam em `src/` com prefixo `omarchy-`.
- `src/manifest.tsv` é a fonte de verdade para script, título, descrição, atalho e dependências.
- `scripts/install` instala todos os comandos do manifest.
- `scripts/uninstall` remove todos os keybindings gerenciados.
- Não criar wrappers em `~/.local/bin` para scripts deste projeto.

## Caminhos

- Não commitar paths absolutos de usuário; use `~` em exemplos.
- Em documentação, representar home como `~`.
- Em scripts, resolver caminhos com `$HOME` ou com o diretório real do clone.
- Keybindings devem ser gerados pelo install a partir de `src/manifest.tsv`.

## Hyprland

- Não editar arquivos em `~/.local/share/omarchy`.
- Usar `~/.config/hypr/bindings.conf` para binds pessoais.
- Gerenciar binds do projeto dentro do bloco `# BEGIN omarchy-scripts` / `# END omarchy-scripts`.
- Após mudar binds, rodar `hyprctl reload` e `hyprctl configerrors`.

## Shell

- Scripts devem usar `set -euo pipefail`.
- Funções devem ter uma responsabilidade e ficar pequenas.
- Preferir `hyprctl ... -j` com `jq` para ler estado do Hyprland.
- Evitar comandos destrutivos em paths persistentes: `rm`, `dd`, `mkfs`, `sudo`, `systemctl`, `shutdown`, `reboot`.
- `rm` só é aceitável para limpar arquivo temporário criado por `mktemp`.
- Se um comando destrutivo for inevitável, pedir confirmação explícita antes de implementar.

## Documentação

- Todo script novo precisa aparecer no `README.md`.
- A tabela de comandos deve listar título, descrição, atalho, script e dependências.
- Comentar no código apenas riscos, decisões e efeitos colaterais que não são óbvios.

## Validação

- Rodar `bash -n <script>` após editar shell scripts.
- Rodar `./scripts/install` ao mudar manifest ou install.
- Rodar `./scripts/uninstall` quando alterar lógica de remoção.
