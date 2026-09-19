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

## 6. Agents that build features and screen apps

This section is for an agent doing **product work** — a feature, a module, or a
screen app — usually with no human watching each step. Everything above still
applies; this adds what is specific to building rather than fixing.

### Commit as you go, not at the end

You have no human to notice that an hour of work vanished. A session can be cut
short at any moment, so **unpushed work only exists if it is committed**. Commit
each part as soon as it stands on its own — a passing module, a new endpoint, a
new test file — rather than saving one large commit for the end.

If you finish a task and `git status` is not clean, the task is not finished.

### Verify it yourself — nobody else will

Before you call a feature done:

```bash
cd "Virtual Bot"
PYTHONPATH="$PWD" .venv/bin/pytest tests/ -q     # PYTHONPATH is required
```

A new feature without a test is not done. Put the test next to the existing
ones and match their style — they carry explanations of *why* the behaviour
matters, not just assertions.

Then exercise the real thing, not only the test: start the server, hit the
endpoint, look at the screen. Tests pass on code that is wired to nothing.

### Screen apps (`Virtual Bot/store/packages/`)

A new app is just a new folder — no build step, no registration:

```
store/packages/<id>/
  package.json   # id, type, label, icon, tint, version, author, description, entry
  index.html     # entry point, self-contained
```

Constraints that are not negotiable, because the target is a 2.4" 320x240
display on a Raspberry Pi 3:

- animate **only** `transform` and `opacity`;
- no `filter`, `blur`, or `box-shadow` on anything that moves;
- no gradients under animation;
- the app must work offline — no CDN, no external fonts.

Read `Virtual Bot/docs/SCREEN-PLATFORM.md` before writing one.

### Do not widen the scope

Build what was asked. If you find a second problem on the way, finish the first
one, commit it, and report the second — do not fold an unrequested refactor into
the same change. The owner decides what gets built.

---

## 7. Quick checklist before you finish a task

- [ ] `git status` reviewed — only intended files staged
- [ ] No secrets in the diff
- [ ] Build/tests pass for the touched module
- [ ] Commit message follows the convention above
- [ ] `HANDOFF.md` updated if the change affects project state / known bugs
