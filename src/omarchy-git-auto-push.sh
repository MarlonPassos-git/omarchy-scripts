#!/usr/bin/env bash
set -euo pipefail

repository_root() {
  local configured_path="$1"
  git -C "$configured_path" rev-parse --show-toplevel 2>/dev/null
}

repository_branch() {
  local repo_root="$1"
  git -C "$repo_root" symbolic-ref --quiet --short HEAD 2>/dev/null
}

repository_upstream() {
  local repo_root="$1"
  git -C "$repo_root" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null
}

canonical_push_destination() {
  local repo_root="$1" remote_name="$2" push_url canonical_url
  push_url=$(git -C "$repo_root" remote get-url --push "$remote_name" 2>/dev/null) || return 1
  case "$push_url" in
    http://*|https://*) canonical_url="${push_url#*://}"; canonical_url="${canonical_url#*@}" ;;
    ssh://*) canonical_url="${push_url#ssh://}"; canonical_url="${canonical_url#*@}" ;;
    *@*:*) canonical_url="${push_url#*@}"; canonical_url="${canonical_url/:/\/}" ;;
    *) return 1 ;;
  esac
  printf '%s\n' "${canonical_url%.git}"
}

policy_rejection_reason() {
  local policy_name="$1" branch_name="$2" upstream_name="$3"
  local remote_name="${upstream_name%%/*}" tracked_branch="${upstream_name#*/}"
  [[ "$tracked_branch" == "$branch_name" ]] || { printf 'upstream branch is %s' "$tracked_branch"; return; }
  [[ "$policy_name" != work || ("$branch_name" != main && "$branch_name" != master) ]] || { printf 'protected work branch'; return; }
  [[ "$policy_name" != work || "$remote_name" == origin ]] || printf 'work remote is %s' "$remote_name"
}

repository_divergence() {
  local repo_root="$1"
  git -C "$repo_root" rev-list --left-right --count 'HEAD...@{upstream}' 2>/dev/null
}

run_repository_push() {
  local repo_root="$1" branch_name="$2" remote_name="$3" dry_run_flag="$4"
  local -a push_arguments=(push --porcelain)
  [[ "$dry_run_flag" == true ]] && push_arguments+=(--dry-run)
  push_arguments+=("$remote_name" "HEAD:refs/heads/$branch_name")
  printf 'Push %s: HEAD -> %s/%s\n' "$repo_root" "$remote_name" "$branch_name"
  git -C "$repo_root" "${push_arguments[@]}"
}

push_if_ahead() {
  local repo_root="$1" branch_name="$2" remote_name="$3" dry_run_flag="$4"
  local ahead_count behind_count divergence
  divergence=$(repository_divergence "$repo_root") || { printf 'Error %s: unreadable upstream divergence.\n' "$repo_root" >&2; return 1; }
  read -r ahead_count behind_count <<< "$divergence"
  [[ "$behind_count" == 0 ]] || { printf 'Skip %s: %s commit(s) behind upstream.\n' "$repo_root" "$behind_count"; return; }
  [[ "$ahead_count" != 0 ]] || { printf 'Skip %s: already up to date.\n' "$repo_root"; return; }
  run_repository_push "$repo_root" "$branch_name" "$remote_name" "$dry_run_flag"
}

process_repository() {
  local policy_name="$1" configured_path="$2" expected_destination="$3" dry_run_flag="$4"
  local repo_root branch_name upstream_name remote_name actual_destination rejection_reason
  repo_root=$(repository_root "$configured_path") || { printf 'Error %s: not a Git worktree.\n' "$configured_path" >&2; return 1; }
  branch_name=$(repository_branch "$repo_root") || { printf 'Skip %s: detached HEAD.\n' "$repo_root"; return; }
  upstream_name=$(repository_upstream "$repo_root") || { printf 'Skip %s: no upstream.\n' "$repo_root"; return; }
  rejection_reason=$(policy_rejection_reason "$policy_name" "$branch_name" "$upstream_name")
  [[ -z "$rejection_reason" ]] || { printf 'Skip %s: %s.\n' "$repo_root" "$rejection_reason"; return; }
  remote_name="${upstream_name%%/*}"
  actual_destination=$(canonical_push_destination "$repo_root" "$remote_name") || { printf 'Error %s: unsupported push URL.\n' "$repo_root" >&2; return 1; }
  [[ "$actual_destination" == "$expected_destination" ]] || { printf 'Error %s: destination is %s, expected %s.\n' "$repo_root" "$actual_destination" "$expected_destination" >&2; return 1; }
  push_if_ahead "$repo_root" "$branch_name" "$remote_name" "$dry_run_flag"
}

process_config_line() {
  local config_line="$1" dry_run_flag="$2" policy_name configured_path expected_destination extra_field
  IFS='|' read -r policy_name configured_path expected_destination extra_field <<< "$config_line"
  [[ -z "${extra_field:-}" && -n "$configured_path" && -n "$expected_destination" ]] || { printf 'Invalid config line: expected policy|path|destination.\n' >&2; return 1; }
  [[ "$policy_name" == personal || "$policy_name" == work ]] || { printf 'Invalid policy %s: expected personal or work.\n' "$policy_name" >&2; return 1; }
  process_repository "$policy_name" "$configured_path" "$expected_destination" "$dry_run_flag"
}

process_repository_config() {
  local config_path="$1" dry_run_flag="$2" config_line failure_count=0
  while IFS= read -r config_line || [[ -n "$config_line" ]]; do
    [[ -z "${config_line//[[:space:]]/}" || "$config_line" =~ ^[[:space:]]*# ]] && continue
    process_config_line "$config_line" "$dry_run_flag" || ((failure_count += 1))
  done < "$config_path"
  return "$failure_count"
}

main() {
  local config_path="${GIT_AUTO_PUSH_CONFIG:-$HOME/.config/git-auto-push/repositories.conf}" dry_run_flag=false
  [[ "${1:-}" == --dry-run ]] && dry_run_flag=true
  if [[ "$#" -gt 1 || ("$#" -eq 1 && "$dry_run_flag" == false) ]]; then printf 'Invalid arguments: %s; expected no arguments or --dry-run.\n' "$*" >&2; return 2; fi
  [[ -f "$config_path" ]] || { printf 'Missing config: %s; expected policy|path|destination lines.\n' "$config_path" >&2; return 2; }
  process_repository_config "$config_path" "$dry_run_flag"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
