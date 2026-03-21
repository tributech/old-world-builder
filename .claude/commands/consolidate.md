# Consolidate Fork Commits

Squash/reorganize our fork's commits on top of upstream into clean themed commits.

## Target Commit Themes

Our fork commits should be organized into these logical groups (in order, bottom to top):

1. **Fork infrastructure** — CI/CD, CDN compatibility (inline SVG icons), PWA removal, build config
2. **Battle Builder rebrand** — OWR theme, `owr-overrides.css`, logo, header/footer, app naming
3. **OWR cloud sync** — `owr-sync.js`, auth integration, pull/push logic, delta sync, dirty tracking
4. **OWR Pro gate** — Pro entitlement checks, upgrade dialog, Go Pro button, sync gating
5. **OWR features** — Tournament submission, any other OWR-specific feature additions
6. **OWR fixes** — Bug fixes, compatibility patches, dark mode fixes, Sentry removal, misc cleanup

Not all groups need a commit — if a group has no changes, skip it. Some groups may be combined if the changes are small.

## Steps

1. Run `git log --oneline upstream/main..HEAD` to show current fork commits.
2. Run `git diff --stat upstream/main..HEAD` to see all changed files.
3. Analyze the current commits and their contents. Map each change to the target themes above.
4. Present the proposed commit plan to the user:
   - Which commits will be created
   - What changes go into each
   - Show the proposed commit messages
5. **Wait for user approval before proceeding.**
6. Perform the consolidation using `git reset --soft` to upstream/main, then selectively stage and commit in theme order:
   - `git reset --soft upstream/main` (keeps all changes staged)
   - For each themed commit: `git reset HEAD .` to unstage all, then `git add` the relevant files and `git commit`
   - Use `git diff --cached --stat` before each commit to confirm what's included
7. Run `git log --oneline upstream/main..HEAD` to show the final result.
8. Ask user to confirm before pushing.
9. Push and retag:
   ```
   git push origin main --force-with-lease
   git tag -f owr_latest
   git push origin owr_latest --force
   ```

## Important

- NEVER lose changes. After consolidation, `git diff upstream/main..HEAD` should produce the exact same diff as before.
- The `owr_latest` tag MUST be updated after every push to main.
- If anything goes wrong, `git reflog` can recover the previous state.
