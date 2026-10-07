# Contributing

## Checks

```bash
bin/check
```

Run it before committing. It is everything CI runs, plus the two stages that
need an Omarchy box. Any failing stage exits non-zero, and skipped stages are
listed, so a partial run never reads as green.

| Stage | Fails on |
|---|---|
| `bash -n`, once per script | a shell script that does not parse |
| `bin/check-agent-files` | an agent-instruction file anywhere in the tree |
| `manifest.json` parse | invalid JSON |
| `node --test`, both suites | any test failure |
| `Model.js` against the pinned upstream sha | any divergence at all (runs in CI too) |
| `qmllint` type resolution | `Panel.qml` referencing shell API this omarchy lacks |
| `Style` members | `Panel.qml` using a `Style` member the installed omarchy lacks |
| `omarchy plugin validate` | manifest schema |
| `tools/sync-upstream --check` | never; reports where this fork sits |
| `tools/sync-upstream --diff` | never; prints this fork's changes as a patch |

Four of those deserve a note.

**`Model.js` must stay byte-identical to upstream.** The README calls it
unchanged, and every line added to it is a line that can conflict on the next
sync. Upstream tests it in `test/shell.d/power-test.sh`, so churn there is noise
for them as well. If this stage fails, the fix is almost always to revert
`Model.js` and put the code somewhere else.

**The shell API stages are the important ones.** A cloned first-party panel is
not self-contained: it imports types and singleton members the shell provides,
so panel code from a newer omarchy can reference API this machine does not
have. `ShellIpc` and `Style.duration()` both shipped here first and both failed
silently, the widget just never appearing in the bar. Type resolution reuses
qmllint's own resolver rather than a hand-rolled list, so nothing new to
maintain; `signal-handler-parameters` is excluded because upstream's own file
produces it. The `Style` check exists separately because qmllint structurally
cannot catch a missing member on a singleton that does resolve.

**`qmllint` is otherwise gated on its exit status, not its output.** qmllint
reports everything as `Warning: ... [category]`, a fatal syntax error included,
so grepping for `Error` finds nothing. The exit code is the signal: 0 when the
file parses, 255 when it does not.

**The two shell API stages are gated separately, because they need different
things.** The `Style` check is `grep` against the installed `Style.qml` and needs
nothing but `$SHELL_DIR`; only type resolution runs `qmllint`. They used to sit
in one `if/elif`, so a box with Qt installed but unlinked skipped both and
reported the missing shell directory as the reason, which was false. `qmllint`
lives in `/usr/lib/qt6/bin` without a symlink into `/usr/bin`, so `command -v`
misses it on most boxes; `bin/check` probes that directory and the
`x86_64-linux-gnu` variant, then falls back to `PATH`. Each skip now names its
own cause, and a skip is a skip of one stage rather than two.

Stages skipped: no `omarchy` (off-box), no `qmllint` (not installed), no
upstream shell tree. The shell API stages can never run in CI, which has no
Omarchy; they run for anyone who clones the repo on an Omarchy box. The `Style`
stage runs anywhere `$SHELL_DIR` exists, so it runs with or without `qmllint`.

## Tests

```bash
node --test tests/conservation.test.cjs   # the logic
node --test tests/helper.test.cjs         # the helper's arguments and writes
```

Neither needs root, a Lenovo, or anything in `/sys`. The helper's privileged
path is exercised through `unshare -r`, which maps the caller to uid 0 in a
throwaway user namespace, with the sysfs glob rewritten to point at a temporary
tree. The host is untouched.

`tests/conservation.test.cjs` covers `Conservation.js`: the words the helper
prints, the state mapping, and the value check that gates `pkexec`.
`tests/helper.test.cjs` covers `bin/lenovo-power-conservation`: argument
validation, exit codes, the write, and the agreement between the helper,
`install.sh` and `uninstall.sh` about the path they share.

One gap, on purpose. The branch that reports a write the kernel refused needs a
sysfs attribute that rejects a value, which a plain file cannot be, so that test
asserts the check is present rather than pretending to exercise it.

## Keeping `Panel.qml` mergeable

`Panel.qml` is upstream's. Everything this fork adds is an insertion, never an
edit of a line upstream owns, and every block is marked:

```qml
// ---------- Lenovo battery conservation ----------
```

Do not reformat, reorder or tidy anything you did not add. The merge is clean
whenever the two sides do not share a line, so an insertion is free and an edit
to a line upstream is changing costs a conflict every time.

The only edit inside code upstream owns is two methods appended to the existing
`IpcHandler` block. If you add another, append it after those.

**Check a change stays mergeable rather than assuming it.** Three-way merge
`Panel.qml` against a deliberately adversarial upstream:

```bash
sha=$(sed -n 's/^sha=//p' upstream.lock)
git --git-dir=/tmp/omarchy-power-lenovo-battery-conservation-upstream.git \
    show "$sha:shell/plugins/panels/power/Panel.qml" > /tmp/base.qml
cp /tmp/base.qml /tmp/theirs.qml   # then add an upstream edit to theirs.qml
git merge-file --diff3 -p Panel.qml /tmp/base.qml /tmp/theirs.qml > /tmp/merged.qml
```

Insert into `theirs.qml` at the exact lines this fork appends to. A conflict
whose `||||||| base` section is empty means both sides only added lines, so
resolving is a matter of picking an order. A conflict with content in the base
section means something was edited, and that is the thing to avoid.

## Upstream

```bash
tools/sync-upstream --check   # what upstream has done, and what we have
tools/sync-upstream --diff    # our changes against the pinned base, as a patch
tools/sync-upstream           # merge it in
```

**Reading the fork's own diff before syncing.** `tools/sync-upstream --diff` is
the answer to "what have we changed here?", as a patch rather than a line count.
It diffs each tracked file against the pinned sha, so it is this fork's delta
whatever upstream has done since: it reads the same when you are up to date, when
upstream has moved, and before a merge has run. Output is `git diff`, so it pages
on a terminal and is a valid patch when redirected:

```bash
tools/sync-upstream --diff > fork.patch
git apply --check --reverse fork.patch   # confirm it is exactly the current delta
```

A file that matches the pinned base does not appear at all (`Model.js` in
practice), which is the same signal `--check` gives as "identical to upstream".

**`upstream.lock` tracks the release branch for the omarchy that is installed,
not omarchy's development branch.** The panel is not self-contained: it uses
types and `Style` members the shell provides, so a merge that outruns the shell
breaks the widget in a way that does not announce itself.

`quattro` is omarchy's default branch and rolls forward continuously, so merging
against it imports panel code that no released omarchy has yet. `ShellIpc` and
`Style.duration()` are both on `quattro` today and on neither the installed
release nor the locked one. Use the release branch, `v4-0-4` for omarchy 4.0.4.

The order is therefore: update omarchy first, then merge. While omarchy is
behind, `--check` will keep reporting drift and that is expected. It also warns
when `branch=` and the installed omarchy disagree, so you find out which of the
two you are behind on rather than guessing. `bin/check` is what stops a merge
that would go too far.

After merging, run `bin/check`. The `Model.js` stage will tell you if the merge
touched something it should not have, and the shell API stages will tell you if
the merge outran the omarchy you are running.

## Security

The reasoning behind the root-owned helper lives in the README's
*Privileged setup* section. The short version: the installed copy is the only
thing ever elevated, it takes no path from its caller, and it writes only `0` or
`1`.

If you touch `bin/lenovo-power-conservation`, `install.sh`, `uninstall.sh` or
`policy/`, read that section first. Two invariants the tests currently only
partly cover, and which you should not weaken:

- The helper never re-executes itself. `set` requires already being root, so a
  copy in a user-writable directory cannot elevate itself.
- `install.sh` must not copy the rules example into `/etc/polkit-1`. Nothing
  should persist in the system's authorisation policy unless a person asked for
  it. There is a test asserting exactly that.

## Not allowed in this tree

No `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `SKILL.md`, `.claude/`, `.cursor/` or
anything else `bin/check-agent-files` recognises. `omarchy plugin add` copies
this repository into a path coding agents auto-discover, and the marketplace
refuses plugins carrying those files. `bin/check` enforces it.

Also: no symlinks inside the plugin folder, no personal paths, no secrets, and
nothing machine-specific in fixtures or history.
