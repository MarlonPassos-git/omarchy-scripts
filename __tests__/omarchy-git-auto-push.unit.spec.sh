#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(pwd)/src/omarchy-git-auto-push.sh"

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local expected="$1" actual="$2"
  [[ "$actual" == *"$expected"* ]] || fail "expected '$actual' to contain '$expected'"
}

write_fake_git() {
  local executable_path="$1"
  cat > "$executable_path" <<'FAKE_GIT'
#!/usr/bin/env bash
set -euo pipefail
repo_root=$2
shift 2
case "$1 $2" in
  'rev-parse --show-toplevel') printf '%s\n' "$repo_root" ;;
  'symbolic-ref --quiet') printf '%s\n' "$FAKE_BRANCH" ;;
  'rev-parse --abbrev-ref') printf '%s\n' "$FAKE_UPSTREAM" ;;
  'remote get-url') printf '%s\n' "$FAKE_PUSH_URL" ;;
  'rev-list --left-right') printf '%s\n' "${FAKE_DIVERGENCE:-2 0}" ;;
  'push --porcelain') printf '%s\n' "$*" >> "$FAKE_PUSH_LOG" ;;
  *) printf 'Unexpected fake Git arguments: %s\n' "$*" >&2; exit 1 ;;
esac
FAKE_GIT
  chmod +x "$executable_path"
}

run_git_auto_push() {
  local tmpdir="$1" policy_name="$2" expected_destination="$3"
  printf '%s|%s|%s\n' "$policy_name" "$tmpdir/repo" "$expected_destination" > "$tmpdir/repositories.conf"
  GIT_AUTO_PUSH_CONFIG="$tmpdir/repositories.conf" PATH="$tmpdir:$PATH" \
    "$SCRIPT_PATH" --dry-run 2>&1
}

test_work_main_is_protected() {
  local tmpdir output
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN
  mkdir "$tmpdir/repo"
  write_fake_git "$tmpdir/git"
  output=$(FAKE_BRANCH=main FAKE_UPSTREAM=origin/main FAKE_PUSH_URL=git@bitbucket.org:sdsla/example.git \
    FAKE_PUSH_LOG="$tmpdir/push.log" run_git_auto_push "$tmpdir" work bitbucket.org/sdsla/example)
  assert_contains 'protected work branch' "$output"
  [[ ! -f "$tmpdir/push.log" ]] || fail 'work main branch reached git push'
}

test_work_feature_dry_run_targets_same_origin_branch() {
  local tmpdir output push_arguments
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN
  mkdir "$tmpdir/repo"
  write_fake_git "$tmpdir/git"
  output=$(FAKE_BRANCH=feature/demo FAKE_UPSTREAM=origin/feature/demo FAKE_PUSH_URL=git@bitbucket.org:sdsla/example.git \
    FAKE_PUSH_LOG="$tmpdir/push.log" run_git_auto_push "$tmpdir" work bitbucket.org/sdsla/example)
  push_arguments=$(cat "$tmpdir/push.log")
  assert_contains 'HEAD -> origin/feature/demo' "$output"
  assert_contains '--dry-run origin HEAD:refs/heads/feature/demo' "$push_arguments"
}

test_changed_destination_is_rejected() {
  local tmpdir output exit_code=0
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN
  mkdir "$tmpdir/repo"
  write_fake_git "$tmpdir/git"
  output=$(FAKE_BRANCH=feature/demo FAKE_UPSTREAM=origin/feature/demo FAKE_PUSH_URL=git@evil.example:other/repo.git \
    FAKE_PUSH_LOG="$tmpdir/push.log" run_git_auto_push "$tmpdir" work bitbucket.org/sdsla/example) || exit_code=$?
  [[ "$exit_code" -ne 0 ]] || fail 'changed destination returned success'
  assert_contains 'destination is evil.example/other/repo' "$output"
  [[ ! -f "$tmpdir/push.log" ]] || fail 'changed destination reached git push'
}

test_work_main_is_protected
test_work_feature_dry_run_targets_same_origin_branch
test_changed_destination_is_rejected
printf 'ok - omarchy-git-auto-push\n'
