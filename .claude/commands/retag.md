# Retag

Quick push to main with version bump and owr_latest tag update.

Use this after making changes that need to be pushed. It bumps the fork build number, commits if needed, pushes, and retags.

## Steps

1. Run `git status` and `git diff --stat` to see what's changed.
2. Read the current version from `package.json`. It follows the format `{upstream}.{fork_build}` (e.g. `2.0.14.3`).
3. Increment the fork build number (the last segment after the last dot). For example: `2.0.14.1` → `2.0.14.2`.
4. Update the version in `package.json`.
5. Stage all relevant changes (NOT untracked files in `.claude/`, `docs/`, `tmp/` unless explicitly part of the change).
6. **Hygiene scan**: Before committing, scan staged files for sensitive content. Run `git diff --cached` and check for:
   - Email addresses (`@tributech`, `@oldworld`, or any `user@domain` patterns)
   - Internal URLs/hostnames (`tributech`, `atlassian.net`, private git remotes like `personal:`)
   - API keys/tokens (`sk-`, `pk_`, `api_key`, `ATLASSIAN_API_TOKEN`)
   - Absolute local paths (`/Users/`)
   - Dotfiles that should stay gitignored (`.mcp.json`, `.claude/settings.local.json`)
   If any are found, warn the user and list them. Do NOT proceed until confirmed.
7. Create a commit with a descriptive message summarizing the changes.
8. Ask the user to confirm before pushing.
9. Push and retag:
   ```
   git push origin main
   git tag -f owr_latest
   git push origin owr_latest --force
   ```
10. Print the new version and confirm success.

## Version Scheme

- Format: `{upstream_version}.{fork_build}` — e.g. `2.0.14.1`, `2.0.14.2`
- The upstream portion (e.g. `2.0.14`) comes from upstream's `package.json` and only changes on rebase via `/upstream-sync`
- The fork build number increments with each push of our changes
- `/upstream-sync` resets the fork build to `.1` when rebasing onto a new upstream version

## Important

- The `owr_latest` tag MUST be updated after every push to main.
- If there are no changes to commit, skip the commit and just retag if the tag is behind HEAD.
