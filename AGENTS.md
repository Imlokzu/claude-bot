# AGENTS.md — Instructions for AI Agents & Coding Tools

This file defines the rules that **every** AI agent or coding tool (Claude Code,
Cursor, Copilot, Fable reviewers, etc.) MUST follow when working in this
repository. Read this file fully before making any change.

Project overview and full context live in `HANDOFF.md` and
`claude-bot-full-spec-v3.md`. Comments and UI text are written in Ukrainian;
keep that convention.

---

## 1. Git commit policy (MANDATORY)

**Commit after every logical change.** Do not batch unrelated work into one
commit. A "logical change" = one bug fix, one feature, one file/module edit that
stands on its own.

Workflow for each change:

```bash
git add <the files you changed>
git commit -m "<type>: <short summary>"
```

- Never use `git add -A` / `git add .` blindly — stage only what you changed and
  verify no secrets or ignored files sneak in (`git status` first).
- Never use `--force` on shared branches.
- If a change spans multiple files that belong together, commit them together.

### Commit message convention (Conventional Commits)

```
<type>(<optional scope>): <imperative summary, <=72 chars>

<optional body: what & why, wrap at 72 cols>
```

Allowed `type` values:
- `feat` — new functionality
- `fix` — bug fix (reference the HANDOFF bug number if applicable, e.g. "fix: voice-loop tts reuse hang (bug #1)")
- `refactor` — code change that neither fixes a bug nor adds a feature
- `docs` — documentation only (README, wiki, this file, spec)
- `test` — adding or fixing tests
- `chore` — tooling, deps, config, build
- `perf` — performance improvement

Scope examples: `vision-agent`, `voice-loop`, `display`, `virtual-bot`,
`remote-control`, `setup-wizard`, `plugin`.

Examples:
```
fix(voice-loop): reinit pyttsx3 per call on darwin to avoid silent hang (bug #1)
feat(virtual-bot): add /api/memory endpoints with path-traversal guard
docs: add project wiki.html
```

---

## 2. Identity / attribution

Commits are attributed to the repository's configured `git config user.name`
and `user.email`. Do **not** change the committer identity, impersonate another
person, or hardcode author overrides (`--author=...`) unless the repo owner has
explicitly told you to. If unsure, ask — do not guess an identity.

---

## 3. Secrets — hard rules

- **Never** commit tokens, API keys, or credentials. This includes
  `OPENCLAW_TOKEN`, `ANTHROPIC_API_KEY`, and anything in `config.yaml` that
  holds a secret.
- Secrets come from environment variables (preferred) or local, git-ignored
  config files. See `.gitignore`.
- If you discover a committed secret, stop and flag it — do not just delete it in
  a new commit (it stays in history).

---

## 4. Code-change etiquette

- Prefer **minimal, surgical edits** to existing files over rewrites — this repo
  historically had no diffs, so avoid large blind overwrites.
- Run the relevant build/tests after a change before committing:
  - Python modules: `pytest` in the module folder.
  - TS/JS modules: `npm test` / `tsc --noEmit` / `npm run build`.
- Follow the API contracts already agreed in `HANDOFF.md` and
  `claude-bot-display/API_CONTRACT.md`.

---

## 5. Review process (owner requirement)

Every working agent's output should be verified by a separate adversarial
reviewer agent (Fable, max effort) that hunts for and **fixes** bugs, followed by
a smoke test (start server, curl endpoints incl. a path-traversal attempt
expecting 400, verify static assets, then shut processes down).

---

## 6. Quick checklist before you finish a task

- [ ] `git status` reviewed — only intended files staged
- [ ] No secrets in the diff
- [ ] Build/tests pass for the touched module
- [ ] Commit message follows the convention above
- [ ] `HANDOFF.md` updated if the change affects project state / known bugs
