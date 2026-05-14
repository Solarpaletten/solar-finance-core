# Sprint 0.1 — solar-apply.js (FastAPI edition)

## What this sprint delivers

A new version of `solar-apply.js` adapted from the working Next/TypeScript
edition (v3.1) to the Python/FastAPI stack of Solar Finance Core.

After this sprint is merged, every following sprint can be deployed
through a single command:

```bash
node solar-apply.js sprint-NNN-topic.tar.gz
```

---

## Important — this sprint is special

This is a **bootstrap sprint**. You cannot apply it through the script
itself, because the script doesn't exist in the repo yet. So this one
is applied by hand. Once merged, **all subsequent sprints go through
the script automatically**.

---

## Changes compared to v3.1

The 3-phase git logic (commit / push / override branch / protected branch
warning) is **untouched** — it was already correct in v3.1. Only the
build chain was adapted.

| Step | v3.1 (Next/TS) | v4.0 (Python/FastAPI) |
|------|----------------|-----------------------|
| PORT default | `3000` | `8000` |
| Health probe | `curl /api/health` | `make health` (10-point smoke test) |
| Dependency step | `pnpm install` | warn if `requirements.txt` changed |
| Static check | `tsc --noEmit` | `python -m compileall services/api` |
| Build | `pnpm build` | `make rebuild` |
| Bundle excludes | `node_modules`, `.next`, `dist` | `__pycache__`, `.venv`, `*.pyc`, `tmp` |
| verification.json | read from project root | read from sprint archive |
| Git commit/push | unchanged | unchanged |
| Sprint-scoped staging | unchanged | unchanged |
| Rollback / history | unchanged | unchanged |

Net change: ~15 lines diff.

---

## Apply this sprint by hand

```bash
cd ~/solar-finance-core

# 1. Make sure you're on main and pulled
git checkout main
git pull origin main

# 2. Create the sprint branch
git checkout -b sprint/0.1-apply-script-fastapi

# 3. Extract the sprint archive somewhere temporary
tar -xzf ~/Downloads/sprint-0.1-apply-script-fastapi.tar.gz -C /tmp

# 4. Copy the script into the project root
cp /tmp/sprint-0.1-apply-script-fastapi/solar-apply.js .

# 5. (Optional) keep a copy of verification.json so Kimi can re-run checks
#    Either leave it in the project, or just keep the archive around.
#    By default verification.json is NOT committed (gitignored as 'tmp/' is).
```

---

## Verify locally before pushing

```bash
# 1. Syntax check
node -c solar-apply.js
# expect: no output, exit 0

# 2. Help screen
node solar-apply.js
# expect: 'Solar Dev Pipeline v4 (FastAPI edition)' usage block, exit 1

# 3. History mode (should not crash even with no history)
node solar-apply.js --history
# expect: 'No history yet.' OR a list

# 4. Stack still healthy (regression)
make health
# expect: 10/10 green
```

---

## Push and open PR

```bash
git add solar-apply.js
git status
# expect: ONLY solar-apply.js staged. Nothing else.

git commit -m "feat(deploy): adapt solar-apply.js for Python/FastAPI stack (v4.0)"
git push -u origin sprint/0.1-apply-script-fastapi

gh pr create \
  --base main \
  --head sprint/0.1-apply-script-fastapi \
  --title "[Sprint 0.1] solar-apply.js — FastAPI edition (v4.0)" \
  --body-file - <<'EOF'
## Sprint
Sprint 0.1 — adapt solar-apply.js v3.1 (Next/TS) to v4.0 (Python/FastAPI).

## Scope
- `solar-apply.js` v4.0 replaces (or adds) the deploy pipeline script
- Adapts 5 specific commands: PORT, health probe, dependency check, static check, build
- Does NOT touch: git commit/push 3-phase logic, sprint-scoped staging, rollback, history, bundle/snapshot machinery

## Out of scope (deliberate)
- Python rewrite of the script — v4 stays Node.js (proven base)
- mypy / ruff / pytest hookups — separate future sprint if needed
- GitHub MCP automation — separate sprint
- Pre-commit hooks — separate sprint

## Architecture decisions
1. Keep Node.js. The v3.1 pipeline is battle-tested. We adapt 5 commands, not rewrite.
2. Use `make health` instead of curl, because Solar already has a 10-point smoke test that's more thorough than a single endpoint probe.
3. No auto-install of Python deps. `make rebuild` reinstalls deps inside the Docker image — we only warn if `requirements.txt` changed.
4. `python -m compileall` instead of mypy/ruff. Equivalent to `tsc --noEmit` — syntax only. Style/types are a separate concern.
5. `verification.json` ships **inside the sprint archive**, not the repo. Each sprint declares its own checkpoints.

## Acceptance criteria
- [ ] `node -c solar-apply.js` exits 0
- [ ] `node solar-apply.js` shows v4 usage screen
- [ ] `node solar-apply.js --history` runs without crash
- [ ] `make health` still 10/10 green (no regression)
- [ ] Script lives at project root, executable from `cd ~/solar-finance-core`

## Verification (engineer-side)
- ✅ JS syntax valid (`node -c` passed in sandbox)
- ✅ Diff vs v3.1 is ~15 lines, all in declared categories
- ✅ Git 3-phase logic byte-for-byte preserved (only commit-message tag changed from `[SDP v3]` to `[SDP v4]`)
- ✅ Protected-branch warning preserved
- ✅ Sprint-scoped staging (never `git add .`) preserved

## Audit guidance for Kimi
- Verify line-by-line that **git push logic** matches v3.1 exactly (lines 532-608 in v3.1).
- Confirm the new `runPythonSyntaxCheck()` does not silently swallow errors — `r.status !== 0` must surface stderr.
- Confirm `healthCheck()` timeout is generous (180s) — `make health` calls `/llm/ping` which can take up to 90s on cold Qwen.

## Files changed
```
A  solar-apply.js
```

Just one file. Single-file sprint. Maximum auditability.
EOF
```

---

## After merge

From the next sprint onwards (Sprint 4 SMA Engine first), the flow is:

```bash
# Architect creates the branch
git checkout main && git pull
git checkout -b sprint/4-sma-indicator

# Engineer (Claude) delivers a sprint archive
# (downloaded into ~/Downloads/sprint-004-sma-engine.tar.gz)

# One command does everything
node solar-apply.js ~/Downloads/sprint-004-sma-engine.tar.gz
# → audits, applies, syntax check, make rebuild, verification, git commit/push
```

---

## Rollback

If anything goes wrong in Sprint 0.1 itself (before merge):

```bash
git checkout main
git branch -D sprint/0.1-apply-script-fastapi
rm -f solar-apply.js   # if it was added to the project root
```

For all subsequent sprints, rollback is automatic via the script:

```bash
node solar-apply.js sprint-NNN-topic --rollback
```

---

## Sprint 0.1 audit checklist (specific to this sprint)

In addition to the standard Kimi checklist in `CONTRIBUTING.md`, this
sprint requires:

- [ ] Git push 3-phase logic byte-for-byte matches v3.1 (no behavior drift)
- [ ] Protected branch (main/master) confirmation prompt still in place
- [ ] Sprint-scoped `git add --` still used (never `git add .`)
- [ ] `make health` is invoked correctly with adequate timeout
- [ ] `python -m compileall` failure surfaces line numbers, not just "failed"
- [ ] Bundle excludes don't accidentally exclude `services/api/db/` or similar
- [ ] No hardcoded paths that assume Next.js layout (`pages/`, `app/`, `.next/`)
