# Power - Lenovo Battery Conservation

The first-party power panel - battery icon, charge bar,
cycle count, power profile picker - forked to add Lenovo's battery conservation
mode: the `ideapad_acpi` driver's `conservation_mode` setting, which stops
charging around 80% instead of 100% and slows long-term battery wear on a
machine that spends its life plugged in.

`Panel.qml` and `Model.js` are currently byte-identical to the upstream commit
pinned in `upstream.lock`. `manifest.json` is the only file that differs: the
plugin id, name and description, plus `omarchy.clonedFrom`.

## How this relates to upstream

`Panel.qml` and `Model.js` are a copy of `shell/plugins/panels/power/` from
[basecamp/omarchy][omarchy]. They are kept identical to upstream except for the
lines this fork deliberately changes, so that picking up upstream work stays
cheap.

`manifest.json` declares `omarchy.clonedFrom: omarchy.power`, which is how
Omarchy lets a plugin replace a built-in one. A panel builds its own contents
inline; there is no API for another plugin to add a section to one, and
`clonedFrom` replaces the original rather than layering on top of it. Enabling
this disables the stock Power panel, and removing it brings the stock one back.
The alternative to forking is a separate bar widget with its own panel and IPC
target, which sits beside the Power panel instead of inside it.

`Panel.qml` keeps `moduleName` and `ipcTarget` at `omarchy.power` on purpose:
`clonedFrom` is what routes IPC and the bar slot, so rewriting those two
identifiers would detach the widget from its place in the bar and break
`omarchy-shell omarchy.power`.

[omarchy]: https://github.com/basecamp/omarchy

## Tracking upstream

`upstream.lock` records the omarchy commit this fork was last merged against.
That commit is the common ancestor for every merge.

```bash
tools/sync-upstream --check    # what upstream has done, touches nothing
tools/sync-upstream            # merge it in
```

`sync-upstream` fetches `basecamp/omarchy` into a bare mirror under
`$TMPDIR` (override with `OMARCHY_UPSTREAM_MIRROR` if you want to keep it),
then runs `git merge-file --diff3` over `Panel.qml`, `Model.js` and
`manifest.json`:

- **current** - this fork's file
- **base** - the file at the pinned sha
- **other** - the file at the current upstream tip

Changes that do not overlap combine on their own. Only genuinely conflicting
hunks stop for a human, and the markers are labelled so it is obvious which side
is which:

```
<<<<<<< ours (Panel.qml)
  ShellIpc { // FORK: ours
||||||| base (upstream 0260d2a)
  IpcHandler {
=======
  ShellIpc {
>>>>>>> upstream (quattro b9e0ac4)
```

The pin only advances when every file merged clean. Resolve a conflict, commit
the resolution, then re-run: it merges again from the still-unpinned base, which
by then matches your resolved file, so the second run comes back clean and
re-pins.

## Keeping the diff mergeable

The merge is clean whenever the two sides do not share a line. So:

- Adding a whole new `Process { }`, function, or panel section is free.
- Changing a line upstream is also changing costs a conflict every time.
- Reformatting, reordering, or tidying upstream code costs a conflict forever
  and buys nothing.

Mark additions with a comment naming the feature, so a future conflict is
readable:

```qml
// ---------- Battery conservation ----------
```

Do not reformat `Model.js` unless a feature needs it. Upstream tests it in
`test/shell.d/power-test.sh`, so churn there makes future merges noisy.

## Install

```bash
omarchy plugin add https://github.com/justfortheloveof/omarchy-bar-plugin-power-lenovo-battery-conservation.git --enable
omarchy-restart-shell
```

Source of truth is this directory. `omarchy plugin add` clones it into
`~/.config/omarchy/plugins/io.github.justfortheloveof.power-lenovo-battery-conservation/`;
never edit there.

```bash
omarchy plugin update io.github.justfortheloveof.power-lenovo-battery-conservation --yes
omarchy plugin remove io.github.justfortheloveof.power-lenovo-battery-conservation --yes   # restores the stock panel
```

## License

MIT - see `LICENSE`.
