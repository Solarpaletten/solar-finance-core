#!/usr/bin/env node
// solar-apply.js v5.0 — Solar Dev Pipeline (Python/FastAPI edition)
// ═══════════════════════════════════════════════════════════════
//
// PIPELINE:
//   1. Pre-Deploy Audit  — NEW / PATCH / IDENTICAL / dirs
//   2. Controlled Apply  — diff + backup per file
//   3. Dependency Warn   — flag requirements.txt changes (no auto-install)
//   4. Python Syntax     — python -m compileall services/api
//   5. Architect Decision — Y/N
//   6. Build             — make rebuild (docker compose build api + restart)
//   7. Verification      — checkpoints from verification.json + make health
//   8. History / Bundle  — .solar-history + .solar-bundles
//   9. Git (3-phase)     — commit → push → optional override
//
// CHANGES IN v5.0 (Council request, 16 May 2026):
//   • NEW key [A] = "apply all remaining NEW files" — appears only
//     when current file is NEW. Toggles a sticky flag so subsequent
//     NEW files apply without prompt. PATCH files STILL ask each time
//     (Kimi audit invariant: PATCH = touching existing code = mandatory diff).
//   • Sticky state never auto-applies PATCH. To get behavior back to
//     per-file confirmation, pass --strict.
//   • All v4 safety invariants preserved: backup, diff display,
//     compileall, verification.json, rollback path.
//
// CHANGES IN v4.0 (Sprint 0.1 — FastAPI adaptation):
//   • PORT default 8000 (was 3000)
//   • Health check uses `make health` (was curl /api/health)
//   • Replaced `pnpm install` with requirements.txt change warning
//   • Replaced `tsc --noEmit` with `python -m compileall services/api`
//   • Replaced `pnpm build` with `make rebuild`
//   • Bundle excludes adjusted: __pycache__, .venv, tmp (kept: .env, .git)
//   • Git push 3-phase logic UNCHANGED from v3.1 (still correct)
//   • Sprint-scoped staging UNCHANGED — only files in report.created+modified
//
// READLINE RULE: rl closes ONCE at the very end of main()
//
// USAGE:
//   node solar-apply.js sprint-004-sma-engine.tar.gz
//   node solar-apply.js sprint-004-sma-engine.tar.gz --auto
//   node solar-apply.js sprint-004-sma-engine.tar.gz --strict   (v5: disable [A])
//   node solar-apply.js sprint-004-sma-engine.tar.gz --dry
//   node solar-apply.js sprint-004-sma-engine.tar.gz --no-build
//   node solar-apply.js sprint-004-sma-engine.tar.gz --no-bundle
//   node solar-apply.js sprint-004-sma-engine    --rollback
//   node solar-apply.js                          --history
// ═══════════════════════════════════════════════════════════════

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { execSync, spawnSync } = require('child_process');

// ─── Args ─────────────────────────────────────────────────────
const ARCHIVE    = process.argv[2];
const AUTO       = process.argv.includes('--auto');
const STRICT     = process.argv.includes('--strict');   // v5: disable [A] key
const DRY_RUN    = process.argv.includes('--dry');
const NO_BUILD   = process.argv.includes('--no-build');
const NO_BUNDLE  = process.argv.includes('--no-bundle');
const ROLLBACK   = process.argv.includes('--rollback');
const HISTORY    = process.argv.includes('--history');
const PORT       = process.env.PORT || '8000';  // v4: was 3000

const ROOT        = process.cwd();
const BACKUP_DIR  = path.join(ROOT, '.solar-backups');
const HISTORY_DIR = path.join(ROOT, '.solar-history');
const BUNDLE_DIR  = path.join(ROOT, '.solar-bundles');

// ─── Colors ───────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',  red:    '\x1b[31m',
  green:  '\x1b[32m', yellow: '\x1b[33m',
  blue:   '\x1b[34m', cyan:   '\x1b[36m',
  bold:   '\x1b[1m',  dim:    '\x1b[2m',
};
const c   = (clr, s) => `${clr}${s}${C.reset}`;
const sep = (ch = '─', n = 52) => c(C.dim, ch.repeat(n));

// ─── SAFE readline — ONE instance, closed ONCE at end ─────────
const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

function closeRL() {
  try { rl.close(); } catch {}
}

// ─── Diff helpers ─────────────────────────────────────────────
function countDiffLines(oldTxt, newTxt) {
  const t1 = `/tmp/sdp_a_${Date.now()}`;
  const t2 = `/tmp/sdp_b_${Date.now()}`;
  fs.writeFileSync(t1, oldTxt);
  fs.writeFileSync(t2, newTxt);
  let added = 0, removed = 0;
  try {
    execSync(`diff ${t1} ${t2}`, { encoding: 'utf-8' });
  } catch (e) {
    for (const l of (e.stdout || '').split('\n')) {
      if (l.startsWith('>')) added++;
      else if (l.startsWith('<')) removed++;
    }
  } finally {
    try { fs.unlinkSync(t1); fs.unlinkSync(t2); } catch {}
  }
  return { added, removed };
}

function showColorDiff(oldTxt, newTxt) {
  const t1 = `/tmp/sdp_c_${Date.now()}`;
  const t2 = `/tmp/sdp_d_${Date.now()}`;
  fs.writeFileSync(t1, oldTxt);
  fs.writeFileSync(t2, newTxt);
  try {
    execSync(`diff -u ${t1} ${t2}`, { encoding: 'utf-8' });
  } catch (e) {
    for (const l of (e.stdout || '').split('\n').slice(2)) {
      if      (l.startsWith('+'))  process.stdout.write(c(C.green,  l) + '\n');
      else if (l.startsWith('-'))  process.stdout.write(c(C.red,    l) + '\n');
      else if (l.startsWith('@@')) process.stdout.write(c(C.cyan,   l) + '\n');
      else                         process.stdout.write(c(C.dim,    l) + '\n');
    }
  } finally {
    try { fs.unlinkSync(t1); fs.unlinkSync(t2); } catch {}
  }
}

// ─── Extract ──────────────────────────────────────────────────
function extract(archivePath) {
  const tmp = `/tmp/sdp_${Date.now()}`;
  fs.mkdirSync(tmp, { recursive: true });
  execSync(`tar -xzf "${archivePath}" -C "${tmp}" --strip-components=1`, { stdio: 'pipe' });
  return tmp;
}

// ─── Collect files ────────────────────────────────────────────
const SKIP = new Set(['.gitignore', 'INSTALL.md', 'solar-apply.js',
                      'solar-deploy.js', 'bundle.js', 'README_DEPLOY.txt',
                      'verification.json']);  // v4: verification.json is read separately, not deployed

function collectFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const full = path.join(dir, e);
    if (fs.statSync(full).isDirectory()) collectFiles(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

// ─── Backup ───────────────────────────────────────────────────
function backup(rel, taskName) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) return;
  const dst = path.join(BACKUP_DIR, taskName, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// ─── Rollback ─────────────────────────────────────────────────
function doRollback(taskName) {
  const bkDir = path.join(BACKUP_DIR, taskName);
  if (!fs.existsSync(bkDir)) {
    console.log(c(C.red, `\n❌ No backup found: ${taskName}`));
    const av = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).join(', ') : 'none';
    console.log(c(C.dim, `   Available: ${av}`));
    return;
  }
  const files = collectFiles(bkDir);
  for (const f of files) {
    const dst = path.join(ROOT, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(bkDir, f), dst);
    console.log(c(C.yellow, `   ↩  ${f}`));
  }
  console.log(c(C.green, `\n✅ Rollback done: ${files.length} files restored\n`));
}

// ─── Step 3: Dependency warning (v4 — replaces ensureNodeModules) ─
// We do NOT auto-install. We only warn the architect that requirements.txt
// has changed so they know `make rebuild` will reinstall Python deps inside
// the Docker image. No silent pip install on the host.
function warnRequirementsChange(report) {
  const reqPath = 'services/api/requirements.txt';
  const changed = report.created.includes(reqPath) || report.modified.includes(reqPath);
  if (!changed) return;

  console.log('\n' + sep() + '\n' + c(C.yellow, '⚠️  Dependency change detected'));
  console.log(c(C.yellow, `   ${reqPath} was modified in this sprint.`));
  console.log(c(C.dim,    '   `make rebuild` will reinstall Python deps inside the API image.'));
  console.log(c(C.dim,    '   First rebuild after this may take longer than usual.\n'));
}

// ─── Step 4: Python syntax check (v4 — replaces runTypeCheck) ─
// Equivalent of `tsc --noEmit` for Python: byte-compile every .py file.
// Catches SyntaxError / IndentationError before the docker rebuild.
// Does NOT check types (mypy) or style (ruff) — that's a separate concern.
function runPythonSyntaxCheck() {
  console.log('\n' + sep() + '\n' + c(C.bold, '🔍 Python syntax check (python -m compileall services/api)\n'));

  const r = spawnSync('python3', ['-m', 'compileall', '-q', '-f', 'services/api'], {
    cwd:      ROOT,
    stdio:    'pipe',
    shell:    true,
    encoding: 'utf-8',
  });

  if (r.status === 0) {
    console.log(c(C.green, '✅ No Python syntax errors — clean!\n'));
    return { passed: true, errors: [], count: 0 };
  }

  const raw    = (r.stdout || '') + (r.stderr || '');
  const errors = [];

  // compileall error format examples:
  //   *** Error compiling 'services/api/main.py'...
  //     File "services/api/main.py", line 42
  //       def foo(:
  //              ^
  //   SyntaxError: invalid syntax
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/File "(.+?)", line (\d+)/);
    if (m) {
      // Walk forward to find the actual error class (e.g. SyntaxError: ...)
      let msg = '';
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const em = lines[j].match(/^(\w+Error): (.+)$/);
        if (em) { msg = em[1] + ': ' + em[2]; break; }
      }
      errors.push({
        file:    m[1].replace(ROOT + '/', '').replace(ROOT + '\\', ''),
        line:    parseInt(m[2]),
        code:    'PY-SYNTAX',
        message: msg || '(see output above)',
      });
    }
  }

  const fileCount = new Set(errors.map(e => e.file)).size;

  console.log(sep('─'));
  console.log(c(C.red, `❌ Found ${errors.length} Python syntax error(s) in ${fileCount} file(s):\n`));

  // Always show the raw stderr too — compileall messages can be terse
  if (raw.trim()) {
    console.log(c(C.dim, raw.trim()));
    console.log('');
  }

  errors.forEach((e, i) => {
    console.log(c(C.bold,   `[${String(i + 1).padStart(2)}] ${e.file}:${e.line}`));
    console.log(c(C.yellow, `      ${e.code}`));
    console.log(c(C.dim,    `      ${e.message}`));
    console.log('');
  });

  console.log(sep('─'));
  console.log(c(C.dim, `   ${errors.length} error(s) in ${fileCount} file(s)`));
  console.log(c(C.dim, '   Note: these may be pre-existing issues, not from this task\n'));

  return { passed: false, errors, count: errors.length };
}

// ─── Step 6: Build (v4 — replaces runBuildSync) ─
function runBuildSync(taskName) {
  console.log('\n' + sep() + '\n' + c(C.bold, '⚡ make rebuild\n'));
  const r = spawnSync('make', ['rebuild'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status === 0) {
    console.log(c(C.green, '\n✅ Build PASSED\n'));
    return true;
  }
  console.log(c(C.red, '\n❌ Build FAILED'));
  console.log(c(C.dim, `   Rollback: node solar-apply.js ${taskName} --rollback\n`));
  return false;
}

// ─── Health check (v4 — uses make health, not curl) ─
// `make health` is Solar's existing 10-point smoke test. Exit code 0 = green.
// Returns true on green, false on any red.
function healthCheck() {
  try {
    execSync('make health', { cwd: ROOT, timeout: 180000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ─── History ──────────────────────────────────────────────────
function showHistory() {
  if (!fs.existsSync(HISTORY_DIR)) { console.log('No history yet.'); return; }
  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json')).sort();
  console.log(c(C.bold, '\n📋 Solar Deploy History\n') + sep());
  for (const f of files) {
    const h     = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8'));
    const build = h.build === 'passed' ? c(C.green, '✅') : h.build === 'failed' ? c(C.red, '❌') : c(C.dim, '○');
    const py    = h.py_errors > 0 ? c(C.yellow, ` PY:${h.py_errors}`) : c(C.green, ' PY:0');
    console.log(`  ${build}${py}  ${c(C.bold, (h.task || f).padEnd(28))}  +${h.files_created} ~${h.files_modified}  ${c(C.dim, (h.timestamp || '').slice(0, 16))}`);
  }
  console.log('');
}

// ─── Save history ─────────────────────────────────────────────
function saveHistory(taskName, data) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(HISTORY_DIR, `${taskName}.json`),
    JSON.stringify({ task: taskName, timestamp: new Date().toISOString(), ...data }, null, 2)
  );
}

// ─── Bundle (v4 — exclusion list adjusted for Python project) ─
function createBundle(taskName, report, buildPassed) {
  fs.mkdirSync(BUNDLE_DIR, { recursive: true });

  const readmePath = path.join(ROOT, 'README_DEPLOY.txt');
  fs.writeFileSync(readmePath, [
    `Solar Finance Core — Deploy Bundle`,
    `${'═'.repeat(40)}`,
    `Task:   ${taskName}`,
    `Status: ${buildPassed ? 'SUCCESS' : 'BUILD FAILED'}`,
    `Date:   ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    ``,
    `Files created:  ${report.created.length}`,
    `Files modified: ${report.modified.length}`,
    ``,
    `Run:  docker compose up -d && make health`,
  ].join('\n'));

  const outPath = path.join(BUNDLE_DIR, `after_${taskName}.tar.gz`);
  const ex = [
    '--exclude=.git', '--exclude=__pycache__', '--exclude=.venv',
    '--exclude=venv', '--exclude=.env', '--exclude=.env.*',
    '--exclude=.env.local', '--exclude=.solar-backups',
    '--exclude=.solar-bundles', '--exclude=.solar-history',
    '--exclude=*.log', '--exclude=.DS_Store', '--exclude=tmp',
    '--exclude=.pytest_cache', '--exclude=.mypy_cache',
    '--exclude=.ruff_cache', '--exclude=*.pyc',
  ].join(' ');
  execSync(`tar -czf "${outPath}" ${ex} -C "${ROOT}" .`, { stdio: 'pipe' });
  try { fs.unlinkSync(readmePath); } catch {}

  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  return { path: outPath, kb };
}

// ─── Deploy Report ────────────────────────────────────────────
function printReport(taskName, report, buildResult, pyResult, bundleInfo) {
  const ok   = c(C.green, '✅');
  const fail = c(C.red,   '❌');
  const skip = c(C.dim,   '○');

  console.log('\n' + sep('━'));
  console.log(c(C.bold, `🚀 TASK ${taskName.toUpperCase()} — DEPLOY REPORT`));
  console.log(sep('━'));

  console.log(`\n   📁 New:        ${c(C.green,  String(report.created.length).padStart(3))}`);
  console.log(`   🔧 Modified:   ${c(C.yellow, String(report.modified.length).padStart(3))}`);
  console.log(`   📂 New dirs:   ${c(C.blue,   String(report.dirs.length).padStart(3))}`);
  console.log(`   ⏭  Skipped:    ${c(C.dim,    String(report.skipped).padStart(3))}`);

  if (report.created.length > 0) {
    console.log('\n' + sep() + '\n' + c(C.bold, '📁 CREATED:'));
    report.created.forEach(f => console.log(c(C.green,  `   + ${f}`)));
  }
  if (report.modified.length > 0) {
    console.log('\n' + sep() + '\n' + c(C.bold, '🔧 MODIFIED:'));
    report.modified.forEach(f => console.log(c(C.yellow, `   ~ ${f}`)));
  }
  if (report.diffSummary.length > 0) {
    console.log('\n' + sep() + '\n' + c(C.bold, '🧾 DIFF:'));
    report.diffSummary.forEach(d => {
      console.log(`   ~ ${path.basename(d.file).padEnd(36)} ${c(C.green, '+' + d.added)} ${c(C.red, '-' + d.removed)}`);
    });
  }
  if (report.modified.length > 0) {
    console.log('\n' + sep() + '\n' + c(C.bold, '💾 BACKUP:'));
    console.log(c(C.green, `   ✔ ${report.modified.length} files → .solar-backups/${taskName}/`));
    console.log(c(C.dim,   `   Rollback: node solar-apply.js ${taskName} --rollback`));
  }

  console.log('\n' + sep() + '\n' + c(C.bold, '🔍 PYTHON SYNTAX:'));
  if (pyResult === null) {
    console.log(`   ${skip} skipped`);
  } else if (pyResult.passed) {
    console.log(`   ${ok} 0 errors`);
  } else {
    console.log(`   ${fail} ${pyResult.count} error(s) — fix before next task`);
  }

  console.log('\n' + sep() + '\n' + c(C.bold, '⚙️  BUILD:'));
  if (buildResult === null)        console.log(`   ${skip} skipped`);
  else if (buildResult === true)   console.log(`   ${ok} PASSED`);
  else                             console.log(`   ${fail} FAILED`);

  const alive = healthCheck();
  console.log('\n' + c(C.bold, '🌐 HEALTH (make health):'));
  console.log(`   ${alive ? ok : skip} ${alive ? 'all checks green' : 'not green — see `make health` output'}`);
  console.log(c(C.dim, `   API expected at http://localhost:${PORT}`));

  if (bundleInfo) {
    console.log('\n' + c(C.bold, '📦 BUNDLE:'));
    console.log(c(C.green, `   ✔ ${bundleInfo.path}`));
    console.log(c(C.dim,   `   ${bundleInfo.kb} KB`));
  }

  console.log('\n' + sep('━'));
  if (buildResult === true) {
    console.log(c(C.bold + C.green, '   ✅ READY FOR NEXT TASK'));
  } else if (buildResult === false) {
    console.log(c(C.bold + C.red,   '   ⚠️  BUILD FAILED'));
  } else {
    console.log(c(C.bold + C.yellow,'   ○  BUILD SKIPPED — run `make rebuild` when ready'));
  }
  console.log(sep('━') + '\n');
}

// ─── Verification checkpoints ─────────────────────────────────
// Reads verification.json FROM THE EXTRACTED SPRINT (not project root).
// This is a v4 change: each sprint ships its own verification.json,
// it does not live permanently in the repo.
function printVerification(verData, taskName) {
  if (!verData) return;

  console.log('\n' + sep('━'));
  console.log(c(C.bold, `🌐 POST-DEPLOY CHECKPOINTS — ${verData.title || taskName.toUpperCase()}`));
  console.log(sep('━'));

  (verData.checks || []).forEach((check, i) => {
    console.log(c(C.bold, `\n[${i + 1}] ${check.name}`));
    if (check.file) console.log(c(C.dim,  `    From: ${check.file}`));
    const cmd = check.url || check.cmd || '';
    const isCmd = cmd.startsWith('curl') || cmd.startsWith('make') || cmd.startsWith('docker');
    console.log(isCmd
      ? c(C.cyan, `    CMD:  ${cmd}`)
      : c(C.blue, `    URL:  ${cmd}`));
    console.log(c(C.green, `    ✔     ${check.what}`));
  });

  console.log('\n' + sep('━'));
  console.log(c(C.bold, '   ✅ VALIDATE THESE BEFORE NEXT TASK'));
  console.log(sep('━') + '\n');
}


// ─── Git Commit ─────────────────────────────────────────────────
// UNCHANGED from v3.1 — 3-phase: commit / push / override branch.
// Stages only sprint-declared files (report.created + report.modified),
// never `git add .`. Protects main/master with typed confirmation.
async function runGitCommit(taskName, report) {
  const { spawnSync: sp, execSync: ex } = require('child_process');

  console.log('\n' + sep('━'));
  console.log(c(C.bold, '📝 GIT — Commit & Push'));
  console.log(sep('━'));

  // ── Check changes ──────────────────────────────────────────────
  let hasChanges = false;
  let statusLines = [];
  try {
    const st = ex('git status --porcelain', { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' }).trim();
    hasChanges = st.length > 0;
    statusLines = st.split('\n').filter(Boolean);
  } catch {}

  if (!hasChanges) {
    console.log(c(C.dim, '\n   Nothing to commit — working tree clean.\n'));
    return;
  }

  // ── Detect current branch ──────────────────────────────────────
  let currentBranch = '';
  try {
    currentBranch = ex('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    console.log(c(C.red, '\n❌ Cannot detect current branch — git error\n'));
    return;
  }

  // ── Build sprint-scoped file list (NEVER `git add .`) ──────────
  const sprintFiles = [...new Set([...report.created, ...report.modified])];

  console.log(c(C.dim, '\n   Working tree status (git status --porcelain):'));
  statusLines.forEach(l => console.log(c(C.dim, '   ' + l)));

  console.log(c(C.bold, '\n   Will stage ONLY sprint files (' + sprintFiles.length + '):'));
  sprintFiles.forEach(f => console.log(c(C.green, '   + ' + f)));

  const sprintSet = new Set(sprintFiles);
  const leftBehind = statusLines
    .map(l => l.slice(3))
    .filter(p => p && !sprintSet.has(p));
  if (leftBehind.length > 0) {
    console.log(c(C.yellow, '\n   ⚠ Not staging (left in working tree):'));
    leftBehind.forEach(p => console.log(c(C.yellow, '   - ' + p)));
    console.log(c(C.dim, '   (these are NOT included in this commit — handle separately)'));
  }

  // ── Auto-generate commit message ───────────────────────────────
  const parts = [];
  if (report.created.length > 0)  parts.push('+' + report.created.length + ' new');
  if (report.modified.length > 0) parts.push('~' + report.modified.length + ' patched');

  const keyFiles = sprintFiles
    .map(f => path.basename(f, path.extname(f)))
    .slice(0, 3).join(', ');

  const autoMsg = 'task' + taskName + ': ' +
    (parts.length > 0 ? parts.join(', ') : 'deploy') +
    (keyFiles ? ' — ' + keyFiles : '') +
    ' [SDP v4]';

  console.log(c(C.bold, '\n   Auto commit message:'));
  console.log(c(C.cyan, '   "' + autoMsg + '"'));

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1 — Commit decision
  // ═══════════════════════════════════════════════════════════════
  const commitAns = (await ask(
    c(C.bold, '\n   [Phase 1] Commit changes? [Y] yes  [E] edit message  [N] no  > ')
  )).toLowerCase().trim();

  if (commitAns === 'n' || commitAns === '') {
    console.log(c(C.dim, '\n   Commit skipped. Manual command if you want it later:'));
    console.log(c(C.cyan, '   git add ' + sprintFiles.map(f => JSON.stringify(f)).join(' ')));
    console.log(c(C.cyan, '   git commit -m "' + autoMsg + '"\n'));
    return;
  }

  let commitMsg = autoMsg;
  if (commitAns === 'e') {
    const edited = (await ask(c(C.bold, '   New message: '))).trim();
    if (edited) commitMsg = edited;
    console.log(c(C.dim, '   Message: "' + commitMsg + '"'));
  } else if (commitAns !== 'y') {
    console.log(c(C.yellow, '\n   Unrecognized answer — treating as N (skip).\n'));
    return;
  }

  // ── Stage ONLY sprint files (explicit paths, never `git add .`) ─
  const addArgs = ['add', '--', ...sprintFiles];
  const ar = sp('git', addArgs, { cwd: ROOT, stdio: 'inherit' });
  if (ar.status !== 0) {
    console.log(c(C.red, '\n❌ git add failed for one or more sprint files\n'));
    return;
  }
  console.log(c(C.green, '\n   ✅ Staged ' + sprintFiles.length + ' sprint file(s) — nothing else'));

  // ── git commit ─────────────────────────────────────────────────
  const cr = sp('git', ['commit', '-m', commitMsg], { cwd: ROOT, stdio: 'inherit' });
  if (cr.status !== 0) {
    console.log(c(C.red, '\n❌ git commit failed\n'));
    return;
  }
  console.log(c(C.green, '\n   ✅ Committed locally'));

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2 — Push decision
  // ═══════════════════════════════════════════════════════════════
  console.log(c(C.dim, '\n   Detected branch:  ') + c(C.bold, currentBranch));
  console.log(c(C.dim, '   Push target:      ') + c(C.bold, 'origin/' + currentBranch));

  const isProtected = (currentBranch === 'main' || currentBranch === 'master');
  if (isProtected) {
    console.log(c(C.red, '\n   ⚠️  WARNING: you are on protected branch "' + currentBranch + '"'));
    console.log(c(C.red, '   ⚠️  Pushing directly to ' + currentBranch + ' bypasses PR + audit.'));
    console.log(c(C.red, '   ⚠️  Type the branch name EXACTLY to confirm, or anything else to cancel.'));
    const confirm = (await ask(
      c(C.bold, '   Confirm push to "' + currentBranch + '"? Type branch name: ')
    )).trim();
    if (confirm !== currentBranch) {
      console.log(c(C.yellow, '\n   Push cancelled. Commit remains LOCAL on ' + currentBranch + '.'));
      console.log(c(C.dim, '   Run later if needed:'));
      console.log(c(C.cyan, '   git push origin ' + currentBranch + '\n'));
      return;
    }
  }

  const pushAns = (await ask(
    c(C.bold, '\n   [Phase 2] Push to origin/' + currentBranch + '? [Y] yes  [O] override branch  [N] no  > ')
  )).toLowerCase().trim();

  if (pushAns === 'n' || pushAns === '') {
    console.log(c(C.dim, '\n   Push skipped. Commit is LOCAL on ' + currentBranch + '.'));
    console.log(c(C.dim, '   When ready:'));
    console.log(c(C.cyan, '   git push origin ' + currentBranch + '\n'));
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3 — Override branch (optional)
  // ═══════════════════════════════════════════════════════════════
  let pushBranch = currentBranch;
  if (pushAns === 'o') {
    const override = (await ask(
      c(C.bold, '   Target branch name (will create on remote if new): ')
    )).trim();
    if (!override) {
      console.log(c(C.yellow, '\n   No branch entered — push cancelled.'));
      console.log(c(C.cyan, '   git push origin ' + currentBranch + '\n'));
      return;
    }
    pushBranch = override;
    console.log(c(C.dim, '   Override target: ') + c(C.bold, 'origin/' + pushBranch));
  } else if (pushAns !== 'y') {
    console.log(c(C.yellow, '\n   Unrecognized answer — treating as N (skip push).'));
    console.log(c(C.cyan, '   git push origin ' + currentBranch + '\n'));
    return;
  }

  // ── git push ───────────────────────────────────────────────────
  const pushRefspec = (pushBranch === currentBranch)
    ? currentBranch
    : currentBranch + ':' + pushBranch;

  console.log(c(C.dim, '\n   Pushing to origin/' + pushBranch + '...'));
  const pr = sp('git', ['push', 'origin', pushRefspec], { cwd: ROOT, stdio: 'inherit' });
  if (pr.status !== 0) {
    console.log(c(C.red, '\n❌ git push failed — check remote/branch/permissions\n'));
    console.log(c(C.dim, '   Try manually: ') + c(C.cyan, 'git push origin ' + pushRefspec + '\n'));
    return;
  }

  console.log(c(C.green, '\n✅ Committed & pushed → origin/' + pushBranch));
  console.log(c(C.dim,   '   "' + commitMsg + '"\n'));

  if (pushBranch !== 'main' && pushBranch !== 'master') {
    console.log(c(C.dim, '   Next step: open a PR from "' + pushBranch + '" → main'));
    console.log(c(C.cyan, '   gh pr create --base main --head ' + pushBranch + '\n'));
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {

  // ── Special modes ────────────────────────────────────────────
  if (HISTORY) {
    showHistory();
    closeRL();
    return;
  }

  if (ROLLBACK) {
    if (!ARCHIVE) {
      const av = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).join(', ') : 'none';
      console.log(`Usage: node solar-apply.js <taskName> --rollback\nAvailable: ${av}`);
    } else {
      doRollback(ARCHIVE);
    }
    closeRL();
    return;
  }

  if (!ARCHIVE || !fs.existsSync(ARCHIVE)) {
    console.log([
      c(C.bold, '\n🚀 Solar Dev Pipeline v4 (FastAPI edition)\n'),
      'Usage:',
      '  node solar-apply.js sprint-004-sma-engine.tar.gz',
      '  node solar-apply.js sprint-004-sma-engine.tar.gz --auto',
      '  node solar-apply.js sprint-004-sma-engine.tar.gz --dry',
      '  node solar-apply.js sprint-004-sma-engine.tar.gz --no-build',
      '  node solar-apply.js sprint-004-sma-engine.tar.gz --no-bundle',
      '  node solar-apply.js sprint-004-sma-engine    --rollback',
      '  node solar-apply.js                          --history',
      '',
    ].join('\n'));
    closeRL();
    process.exit(1);
  }

  const taskName = path.basename(ARCHIVE, '.tar.gz')
    .replace(/_clean$/, '').replace(/_v\d+$/, '');

  // ── Header ───────────────────────────────────────────────────
  console.log(c(C.bold, '\n🚀 Solar Dev Pipeline v4 (FastAPI)'));
  console.log(sep('═'));
  console.log(`   Task:    ${c(C.bold, taskName)}`);
  console.log(`   Archive: ${ARCHIVE}`);
  if (DRY_RUN) console.log(c(C.yellow, '   Mode:    DRY RUN'));
  if (AUTO)    console.log(c(C.yellow, '   Mode:    AUTO'));
  console.log(sep('═'));

  // ── Step 1: Pre-Deploy Audit ──────────────────────────────────
  const tmpDir = extract(ARCHIVE);
  const files  = collectFiles(tmpDir);

  // v4: read verification.json from the sprint archive if present
  let verData = null;
  const verPath = path.join(tmpDir, 'verification.json');
  if (fs.existsSync(verPath)) {
    try { verData = JSON.parse(fs.readFileSync(verPath, 'utf-8')); } catch {}
  }

  const auditNew   = [];
  const auditPatch = [];
  const auditSkip  = [];

  for (const f of files) {
    const dest   = path.join(ROOT, f);
    const exists = fs.existsSync(dest);
    const newTxt = fs.readFileSync(path.join(tmpDir, f), 'utf-8');
    const same   = exists && fs.readFileSync(dest, 'utf-8') === newTxt;
    if (!exists)   auditNew.push(f);
    else if (same) auditSkip.push(f);
    else           auditPatch.push(f);
  }

  console.log('\n' + sep('━'));
  console.log(c(C.bold, '🔍 PRE-DEPLOY AUDIT'));
  console.log(sep('━'));

  if (auditNew.length > 0) {
    console.log(c(C.bold, `\n📁 NEW FILES (${auditNew.length}) — will be created:`));
    auditNew.forEach(f => console.log(c(C.green,  `   + ${f}`)));
  }
  if (auditPatch.length > 0) {
    console.log(c(C.bold, `\n🔧 PATCH FILES (${auditPatch.length}) — will be modified:`));
    auditPatch.forEach(f => console.log(c(C.yellow, `   ~ ${f}`)));
    console.log(c(C.dim,  `\n   Backups → .solar-backups/${taskName}/`));
  }
  if (auditSkip.length > 0) {
    console.log(c(C.bold, `\n⏭  IDENTICAL (${auditSkip.length}) — will be skipped:`));
    auditSkip.forEach(f => console.log(c(C.dim, `   = ${f}`)));
  }

  console.log('\n' + sep('━'));
  console.log(c(C.bold, `📊 Total: ${c(C.green, auditNew.length + ' new')}  ${c(C.yellow, auditPatch.length + ' patch')}  ${c(C.dim, auditSkip.length + ' skip')}`));
  if (verData) {
    console.log(c(C.dim, `   verification.json: ${verData.checks?.length || 0} checkpoints`));
  }
  console.log(sep('━'));

  if (!AUTO && !DRY_RUN) {
    const go = (await ask(c(C.bold, '\n🚀 Ready to deploy? [Y] go  [Q] quit  > '))).toLowerCase().trim();
    if (go === 'q' || go === 'n') {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      console.log(c(C.dim, '\nDeploy cancelled.\n'));
      closeRL();
      return;
    }
  }

  console.log(c(C.bold, '\n▶ Starting deploy...\n'));

  // ── Step 2: Controlled Apply ──────────────────────────────────
  const report   = { created: [], modified: [], dirs: [], diffSummary: [], skipped: 0 };
  const seenDirs = new Set();

  // v5: sticky flag — once architect chose [A], subsequent NEW files
  // apply without prompting. PATCH files always still ask, regardless.
  // Disabled by --strict for old behavior.
  let applyAllNew = false;

  for (let i = 0; i < files.length; i++) {
    const rel    = files[i];
    const src    = path.join(tmpDir, rel);
    const dest   = path.join(ROOT, rel);
    const newTxt = fs.readFileSync(src, 'utf-8');
    const exists = fs.existsSync(dest);
    const oldTxt = exists ? fs.readFileSync(dest, 'utf-8') : '';
    const same   = exists && oldTxt === newTxt;

    const dir = path.dirname(rel);
    if (dir !== '.' && !fs.existsSync(path.join(ROOT, dir)) && !seenDirs.has(dir)) {
      seenDirs.add(dir);
      report.dirs.push(dir);
    }

    const badge = !exists ? c(C.green, '[ NEW   ]') : same ? c(C.dim, '[  ───  ]') : c(C.yellow, '[ PATCH ]');
    process.stdout.write(`\n[${i + 1}/${files.length}] ${badge} ${c(C.bold, rel)}\n`);

    if (same) { console.log(c(C.dim, '   identical')); report.skipped++; continue; }

    if (exists) {
      showColorDiff(oldTxt, newTxt);
      const { added, removed } = countDiffLines(oldTxt, newTxt);
      console.log(c(C.dim, `   lines: ${c(C.green, '+' + added)} ${c(C.red, '-' + removed)}`));
    } else {
      newTxt.split('\n').slice(0, 5).forEach(l => console.log(c(C.dim, '   ' + l)));
      if (newTxt.split('\n').length > 5) console.log(c(C.dim, '   ...'));
    }

    if (DRY_RUN) { console.log(c(C.yellow, '   👁 dry')); continue; }

    let ans = 'y';
    if (!AUTO) {
      // v5: if sticky applyAllNew is set AND this file is NEW, skip the prompt.
      // PATCH files always re-prompt (Kimi invariant: never auto-touch existing code).
      if (applyAllNew && !exists) {
        console.log(c(C.dim, '   ↳ auto-applied via [A]'));
        ans = 'y';
      } else {
        // v5: offer [A] only when this file is NEW and --strict not set.
        const promptStr = (!exists && !STRICT)
          ? '   [Y] apply  [A] apply all NEW  [S] skip  [D] diff  [Q] quit  > '
          : '   [Y] apply  [S] skip  [D] diff  [Q] quit  > ';
        ans = (await ask(c(C.bold, promptStr))).toLowerCase().trim() || 'y';

        if (ans === 'd') {
          exists ? showColorDiff(oldTxt, newTxt) : console.log(c(C.green, '   (new file)'));
          ans = (await ask(c(C.bold, '   [Y] apply  [S] skip  > '))).toLowerCase().trim() || 'y';
        }

        if (ans === 'a' && !exists && !STRICT) {
          // Engage sticky mode for all subsequent NEW files in this run.
          applyAllNew = true;
          console.log(c(C.green, '   ✓ [A] engaged — remaining NEW files will apply automatically'));
          ans = 'y';
        } else if (ans === 'a') {
          // 'a' on a PATCH file (or in --strict mode). [A] wasn't offered,
          // so treat as a typo. Fall back to normal 'y' apply — diff was
          // already shown above so the operator has seen what they're
          // applying.
          ans = 'y';
        }

        if (ans === 'q') {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          closeRL();
          process.exit(0);
        }
      }
    }

    if (ans !== 's') {
      backup(rel, taskName);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, newTxt);
      console.log(c(C.green, '   ✅ applied'));
      if (!exists) {
        report.created.push(rel);
      } else {
        report.modified.push(rel);
        const { added, removed } = countDiffLines(oldTxt, newTxt);
        report.diffSummary.push({ file: rel, added, removed });
      }
    } else {
      console.log(c(C.dim, '   ⏭ skipped'));
      report.skipped++;
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (DRY_RUN) {
    console.log(c(C.yellow, '\n👁 Dry run complete — nothing written.\n'));
    closeRL();
    return;
  }

  // ── Quick deploy summary ──────────────────────────────────────
  console.log('\n' + sep('━'));
  console.log(c(C.bold, '📊 DEPLOY SUMMARY:'));
  console.log(`   📁 New:     ${c(C.green,  String(report.created.length))}`);
  console.log(`   🔧 Patched: ${c(C.yellow, String(report.modified.length))}`);
  console.log(`   ⏭  Skipped: ${c(C.dim,    String(report.skipped))}`);
  if (report.modified.length > 0) {
    console.log(c(C.dim, `\n   Backup → .solar-backups/${taskName}/`));
    console.log(c(C.dim, `   Rollback: node solar-apply.js ${taskName} --rollback`));
  }
  console.log(sep('━'));

  // ── Step 3: Dependency Warning (v4) ───────────────────────────
  if (!NO_BUILD) {
    warnRequirementsChange(report);
  }

  // ── Step 4 + 5: Python Syntax Scan + Decision ─────────────────
  let pyResult    = null;
  let buildResult = null;
  let doRunBuild  = false;

  if (!NO_BUILD) {
    pyResult = runPythonSyntaxCheck();

    if (pyResult.passed) {
      const ans = (await ask(c(C.bold, '⚡ Run `make rebuild`? [Y] yes  [N] skip  > '))).toLowerCase().trim();
      doRunBuild = (ans === '' || ans === 'y');
    } else {
      console.log(c(C.bold, '\n⚡ Options:'));
      console.log(`   [Y] Continue with build anyway (errors may cause failure)`);
      console.log(`   [N] Skip build (fix syntax errors first, run \`make rebuild\` manually)`);
      console.log(`   [Q] Quit\n`);
      const ans = (await ask(c(C.bold, '   Choice > '))).toLowerCase().trim();
      if (ans === 'q') {
        closeRL();
        process.exit(0);
      }
      doRunBuild = (ans === '' || ans === 'y');
      if (!doRunBuild) {
        console.log(c(C.dim, '\n   Build skipped. Fix syntax errors, then run: make rebuild\n'));
      }
    }

    if (doRunBuild) {
      buildResult = runBuildSync(taskName);
    }
  }

  // ── Step 8: Bundle ───────────────────────────────────────────
  let bundleInfo = null;
  if (!NO_BUNDLE && buildResult === true) {
    console.log(c(C.bold, '\n📦 Creating clean bundle...'));
    bundleInfo = createBundle(taskName, report, true);
    console.log(c(C.green, `   ✔ ${bundleInfo.path} (${bundleInfo.kb} KB)\n`));
  }

  // ── Save History ──────────────────────────────────────────────
  saveHistory(taskName, {
    files_created:  report.created.length,
    files_modified: report.modified.length,
    files_skipped:  report.skipped,
    dirs_created:   report.dirs.length,
    py_errors:      pyResult ? pyResult.count : null,
    build:          buildResult === true ? 'passed' : buildResult === false ? 'failed' : 'skipped',
    bundle:         bundleInfo?.path || null,
    created:        report.created,
    modified:       report.modified,
  });

  // ── Step 7: Deploy Report ─────────────────────────────────────
  printReport(taskName, report, buildResult, pyResult, bundleInfo);

  // ── Verification Checkpoints ──────────────────────────────────
  if (buildResult === true && verData) {
    printVerification(verData, taskName);
  }

  // ── Git Commit (3-phase) ──────────────────────────────────────
  if (buildResult === true) {
    await runGitCommit(taskName, report);
  }

  closeRL();
}

main().catch(e => {
  console.error(e);
  closeRL();
  process.exit(1);
});
