# Upstream Sync

Rebase our fork's commits on top of the latest upstream/main and push.

## Steps

1. Run `git fetch upstream` to get latest upstream changes.
2. Run `git log --oneline upstream/main..HEAD` to show our fork commits before rebasing. Print these for the user.
3. Run `git rebase upstream/main`. If there are conflicts:
   - Show the conflicting files with `git diff --name-only --diff-filter=U`
   - Show the conflict markers with `git diff`
   - Ask the user how to proceed — do NOT auto-resolve or abort without asking.
4. After successful rebase, run `git log --oneline upstream/main..HEAD` again to confirm our commits are still on top.
5. **Version bump**: Read upstream's `package.json` version (from `upstream/main`) and set ours to `{upstream_version}.1` in `package.json`. This resets our fork build number after each rebase. For example, if upstream is `2.0.15`, set ours to `2.0.15.1`.
6. If the version changed, amend the top commit (or create a small fixup) to include the version bump.
7. Ask the user to confirm before pushing.
8. Push and retag:
   ```
   git push origin main --force-with-lease
   git tag -f owr_latest
   git push origin owr_latest --force
   ```
9. Confirm success with `git log --oneline -3`.

## Important

- The `owr_latest` tag MUST be updated after every push to main.
- Use `--force-with-lease` for the main push (never bare `--force`).
- If rebase fails with conflicts, help the user resolve them before continuing.

## Version Scheme

Our fork uses `{upstream_version}.{fork_build}` versioning:
- Upstream `2.0.14` → our fork is `2.0.14.1`, `2.0.14.2`, etc.
- After rebasing onto a new upstream version (e.g. `2.0.15`), reset to `2.0.15.1`.
- The fork build number increments with each of our own commits/pushes (see `/retag` skill).
