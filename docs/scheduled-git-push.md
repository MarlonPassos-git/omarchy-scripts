# Scheduled Git pushes

`omarchy-git-auto-push` pushes existing commits only. It does not stage files,
create commits, pull, rebase, push tags, or force-push.

## Repository allowlist

The machine-local allowlist lives at
`~/.config/git-auto-push/repositories.conf`. Each entry pins policy, worktree,
and expected remote destination:

```text
personal|~/projects/example|github.com/example/example
work|~/Work/example|bitbucket.org/example/example
```

Paths in the real configuration must be absolute. `personal` accepts
`main`/`master`; `work` blocks them and requires the current branch to track a
same-named branch on `origin`. Every policy rejects detached HEAD, divergent
branches, missing upstreams, and changed remote destinations.

## Setup

Validate and enable four daily runs:

```bash
cd ~/projects/omarchy-scripts
./src/omarchy-git-auto-push.sh --dry-run
systemctl --user link "$PWD/systemd/user/omarchy-git-auto-push.service"
systemctl --user link "$PWD/systemd/user/omarchy-git-auto-push.timer"
systemctl --user enable --now omarchy-git-auto-push.timer
```
