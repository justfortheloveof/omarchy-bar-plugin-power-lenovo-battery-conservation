# Power - Lenovo Battery Conservation

Adds a Battery "conservation mode" toggle, for Lenovo laptops, to the
Omarchy Quattro power bar plugin  
(tested on a ThinkBook 13x G2 IAP)

Uses the `ideapad_acpi` driver's `conservation_mode` setting, which stops charging
around 80% instead of 100% and slows long-term battery wear on a machine that
spends its life plugged in.

## What it does

- Adds a "Conservation mode" toggle to the Omarchy Quattro default power bar plugin
- Shows "Conservation mode" status
- Toggles "Conservation mode" on/off
- Notifies on failure

## CLI Usage

```bash
omarchy-shell omarchy.power conservationStatus   # on, off, or unknown
omarchy-shell omarchy.power toggleConservation   # prints the value it asked for
```

`conservationStatus` answers from what the panel last read: free and instant.

`toggleConservation` is asynchronous. It queues the write to a background
process - the one that raises the dialog - and returns immediately, so its
answer is the value it asked for, not the outcome: `0` or `1`, or nothing if it
could not act. Dismiss the dialog and the mode is unchanged, quietly: that is
an answer, not a fault, so it raises nothing. Any other failure does raise a
notification. Either way the panel re-reads the attribute when the write
finishes, so the row catches up by itself.

## Toggle UI Description

The Conservation Mode toggle sits under **POWER PROFILE**, below the profile
buttons, in the same section rather than behind its own heading.

The current mode is always displayed in words, and the switch beside it shows
on or off. When the plugin cannot read the mode, it says so, because the switch
has no third position to show it in. A switch reading **off** next to a row
calling the mode **unknown** means "not read", not "off" - read the sentence,
not the switch.

| The row says | Switch | What is going on |
| --- | --- | --- |
| *Stop charging around 80% to reduce long-term wear.* | on or off | The mode was read, and that is the current value. Clicking asks for your password. |
| `Current mode unknown. Run sudo ./install.sh in the plugin directory to enable changes.` | off | `install.sh` has not been run, so the mode cannot be read at all - not even the current value. See [Install](#install). |
| `Current mode unknown: the attribute reported a value this plugin does not recognise.` | off | The attribute exists but reports something unexpected, so the plugin will not act on it rather than guess. |
| `No Lenovo conservation_mode attribute here, so conservation mode is always off.` | off | Not a Lenovo IdeaPad. The mode does not exist on this machine, so off here is accurate. |

The three unknown states come from three different places, and only the first is
something you can do anything about: the helper was never installed, the
attribute reported an unexpected value, or the machine has no such attribute.

## Install

> [!NOTE]
> This **replaces** the stock Power panel rather than sitting beside it, and
> removing this plugin brings the stock one back.

1. Add the plugin and enable it
1. Install the privileged helper
1. Restart the shell so the bar and plugins reload

```bash
omarchy plugin add https://github.com/justfortheloveof/omarchy-bar-plugin-power-lenovo-battery-conservation.git --enable
sudo ~/.config/omarchy/plugins/io.github.justfortheloveof.power-lenovo-battery-conservation/install.sh
omarchy-restart-shell
```

### Caching the authorisation

The toggle will prompt for your password using the Omarchy themed. If you would rather not authenticate
on every click, copy the example rules file into place:

```bash
cd ~/.config/omarchy/plugins/io.github.justfortheloveof.power-lenovo-battery-conservation
sudo cp policy/lenovo-power-conservation.rules.example \
     /etc/polkit-1/rules.d/50-lenovo-power-conservation.rules
omarchy-restart-shell
```

It only turns `AUTH_ADMIN` into `AUTH_ADMIN_KEEP` for one exact command line,
`.../conservation set <0|1>`, on a local session, for members of `wheel`.
Nothing else on the system changes, and deleting the file undoes it.

## Updating

```bash
omarchy plugin update io.github.justfortheloveof.power-lenovo-battery-conservation --yes
```

## Uninstalling / Removing

```bash
sudo ~/.config/omarchy/plugins/io.github.justfortheloveof.power-lenovo-battery-conservation/uninstall.sh
omarchy plugin remove io.github.justfortheloveof.power-lenovo-battery-conservation --yes   # restores the stock panel
```

The two are separate. `omarchy plugin remove` only knows about files under
`~/.config/omarchy/plugins`, so it leaves the root-owned helper - and the polkit
rule, if you added one - on the system. `uninstall.sh` takes both:

It removes the helper, and if it finds the optional polkit rule it asks before
removing that too. Answer `y` and both go; anything else leaves the rule alone
and prints the command to remove it yourself.

## How the privileged part works

### Why a root-owned helper

Reading the current "conservation mode" needs no privilege: `conservation_mode`
is world-readable. Writing it does, because the attribute is owned by root, and
the kernel offers no unprivileged route to change it. Something has to run as
root. Because the plugin directory is user writeable, we create a helper file that
can only be modified by the root user so that it is not tampered with:

`install.sh` places a copy of `bin/lenovo-power-conservation` at
`/usr/local/libexec/lenovo-power/conservation`, owned by root and writable by
nobody else, and that installed copy is the only thing the plugin ever asks to be
elevated.

### Why polkit and not sudo

So the prompt is the themed Omarchy dialog. Keeping the experience consistent.

Nothing is granted permanently. `pkexec` is used with the stock
`org.freedesktop.policykit.exec` action, which is `auth_admin`, so **every toggle
authenticates**. There is no sudoers entry involved.

### What lands on disk, and how to remove it

`install.sh` installs exactly one file:

```
/usr/local/libexec/lenovo-power/conservation    root:root, mode 0755
```

Reading the mode fails until that file exists, because reading goes through the
same helper: the row says a setup step is needed and the toggle stays disabled.
Once it is installed, reading is silent and needs no password; only writing
prompts.

There is a second file you may put on the system yourself, and
`install.sh` never does it for you:

```
/etc/polkit-1/rules.d/50-lenovo-power-conservation.rules    only if you took the caching option
```

So `sudo ./uninstall.sh` deals with both: it removes the helper unconditionally,
and offers you the polkit rule as well. It asks rather than assuming, because
the rule is as likely to be something you wrote yourself as a copy of ours, and
because leaving it behind keeps a cached authorisation pointing at a helper that
is no longer there.

To remove it again, `sudo ./uninstall.sh`, or simply delete the file, since it
keeps no state. `omarchy plugin remove` does **not** remove it: that only knows
about files under `~/.config/omarchy/plugins`.

Both the helper and the optional rules file carry their source repository and
licence in their header, so anything installed on your system says where it came
from and how to remove it.

## Development

Everything below is for working on the plugin. If you only want to use it, you
are already done above.

### Keyboard navigation

The panel's keyboard cursor is upstream's own: `cursorActive` plus a flat
`profileIndex` into the profile buttons. We extend that rather than replace it,
so ours is one more boolean in the same idiom, `conservationFocused`, meaning
"the cursor is on our row instead of the profiles".

- `h`/`l` and the left/right arrows move between profiles, unchanged.
- `j`/`k` and up/down walk between the two rows, lighting exactly one row at a
  time.
- Return or Space activates whichever row the cursor is on.
- Hovering a row moves the cursor there, so mouse and keyboard agree and only
  one row is lit.

Two deliberate differences from a stock panel:

- Upstream sends `j`/`k` into the profile list. Here they change rows, and only
  `h`/`l` move between profiles.
- Our row is skipped entirely while it cannot act - before `install.sh` has run,
  or the mode has not been read - so the cursor cannot park on a toggle that
  would refuse to flip. The cost is that the row's "run `sudo ./install.sh`"
  message cannot be read with the keyboard alone.

The row's title is bold because the shared `Toggle` component hardcodes
`font.bold` on its label and offers no property to turn it off. Matching regular
weight, as the network panel's list rows use, would mean replacing a shared
component with a local one - and losing its tab focus and Return/Enter/Space
handling with it. The title size is set to `Style.font.body` so at least the
size matches the rows beside it.

The cursor stays where it was last put. Hovering a row leaves it lit after the
mouse moves away, because that is upstream's behaviour: `cursorActive` is only
ever cleared when the battery appears, so a profile button stays lit the same
way. We match it rather than giving our row a second hover model.

This is the one place where adding a feature meant changing upstream's code
rather than only adding to it: the key dispatcher's `onMoveRequested` and
`onActivateRequested`. Both now call one function of ours, and upstream's
`selectProfileByDelta`, `activateSelectedProfile` and `setProfile` are untouched
behind them. The rules in the next section apply to those two handlers from now
on.

### Relationship to upstream

`Panel.qml` and `Model.js` are a copy of `shell/plugins/panels/power/` from
[basecamp/omarchy][omarchy]. `Model.js` is unchanged; `Panel.qml` is the
installed omarchy's panel plus the conservation section. `manifest.json` is the
only other upstream file this fork changes. `Conservation.js`, `bin/`, `policy/`
and `tests/` are new.

`manifest.json` declares `omarchy.clonedFrom: omarchy.power`, which is how
Omarchy lets a plugin replace a built-in one. A panel builds its own contents
inline; there is no API for another plugin to add a section to one, and
`clonedFrom` replaces the original rather than layering on top of it. The
alternative to forking is a separate bar widget with its own panel and IPC
target, which sits beside the Power panel instead of inside it.

`Panel.qml` keeps `moduleName` and `ipcTarget` at `omarchy.power` on purpose:
`clonedFrom` is what routes IPC and the bar slot, so rewriting those two
identifiers would detach the widget from its place in the bar and break
`omarchy-shell omarchy.power`.

[omarchy]: https://github.com/basecamp/omarchy

### Tracking upstream

`upstream.lock` records the omarchy commit this fork tracks, and that commit is
the common ancestor for every merge.

**It tracks the omarchy you have installed: the release branch, not omarchy's
development branch.** That is the part worth understanding, because getting it
wrong is invisible until the widget fails to appear.

Every release has its own branch (`v4-0-1`, `v4-0-4`, ...), and they form a
fast-forward chain, so after `omarchy update` the pin walks forward from one
release to the next. `quattro` is omarchy's development branch and the repo's
default; merging against it would import panel code that no released omarchy has
yet, which is the failure below, guaranteed.

A cloned first-party panel is not self-contained. It imports types and singleton
members that the shell provides, so panel code from a newer omarchy can
reference API this machine does not have:

| upstream commit | what `Panel.qml` gained | what happens on an older omarchy |
| --- | --- | --- |
| `c231097d` | `ShellIpc`, plus its `qmldir` entry | `ShellIpc is not a type`; the widget never loads and the bar slot is simply empty |
| `b18ab495` | `Style.duration()`, `Style.reduceMotion` | `Style` exists, so these fail as missing members |

Neither produces an error anyone sees. So the order is: **update omarchy first,
then run `tools/sync-upstream`** to advance the pin. Until then, `--check`
reporting drift is correct information rather than an action item, and
`bin/check` fails if the panel ever outruns the shell again.

`--check` also compares the lock's `branch=` against the omarchy installed on
this machine and warns when they disagree, so that ordering rule is checked
rather than only written down. It warns and carries on: a fork tracking an older
omarchy is still a fork worth keeping in step.

```bash
tools/sync-upstream --check    # what upstream has done, and what we have, touches nothing
tools/sync-upstream            # merge it in
```

`sync-upstream` fetches `basecamp/omarchy` into a bare mirror under `$TMPDIR`
(override with `OMARCHY_UPSTREAM_MIRROR` if you want to keep it), then runs
`git merge-file --diff3` over `Panel.qml`, `Model.js` and `manifest.json`:

- **current** - this fork's file
- **base** - the file at the pinned sha
- **other** - the file at the current upstream tip

Changes that do not overlap combine on their own. Only genuinely conflicting
hunks stop for a human, and the markers are labelled so it is obvious which side
is which:

```
<<<<<<< ours (Panel.qml)
  Button { text: root.modeLabel() }   // FORK: ours
||||||| base (upstream c668141e)
  Button { }
=======
  Button { text: root.heroStatusText }   // upstream
>>>>>>> upstream (v4-0-4 c668141e)
```

The pin only advances when every file merged clean. Resolve a conflict, commit
the resolution, then re-run: it merges again from the still-unpinned base, which
by then matches your resolved file, so the second run comes back clean and
re-pins.

### Keeping the diff mergeable

The merge is clean whenever the two sides do not share a line. So:

- Adding a whole new `Process { }`, function, or panel section is free.
- Changing a line upstream is also changing costs a conflict every time.
- Reformatting, reordering, or tidying upstream code costs a conflict forever and
  buys nothing.

Mark additions with a comment naming the feature, so a future conflict is
readable:

```qml
// ---------- Battery conservation ----------
```

The only edits inside code upstream owns are two methods appended to the existing
IPC handler, and the panel key dispatcher's two handlers. If you add another,
append it after those.

Do not reformat `Model.js` unless a feature needs it. Upstream tests it in
`test/shell.d/power-test.sh`, so churn there makes future merges noisy.

Verify a change stays mergeable rather than assuming it: three-way merge
`Panel.qml` against a deliberately adversarial upstream, as
[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) describes. A conflict whose base
section is empty means both sides only added lines, which is the cheap kind.

### Checks and tests

```bash
bin/check     # everything CI runs, plus the stages that need an Omarchy box
```

Run it before committing. Skipped stages are listed, so a partial run never
reads as green.

```bash
node --test tests/conservation.test.cjs   # the logic
node --test tests/helper.test.cjs         # the helper's arguments and writes
```

Neither suite needs root, a Lenovo, or anything in `/sys`. The helper's
privileged path is exercised through `unshare -r`, which maps the caller to uid 0
in a throwaway user namespace; the sysfs glob is rewritten to point at a
temporary tree, so the host is untouched.

`bin/check` guards the two ways this fork has broken before: `Model.js` drifting
from upstream, and `Panel.qml` outrunning the shell API you are running.
[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) explains each stage and what it
skips.

### Where things live

| Path | |
| --- | --- |
| `Panel.qml` | the forked power panel: installed upstream plus our additions |
| `Model.js` | upstream, unchanged, and must stay that way |
| `Conservation.js` | pure logic for panel state and navigation: turning the helper's output into state, and moving the keyboard cursor between rows |
| `manifest.json` | plugin id, `clonedFrom: omarchy.power` |
| `bin/lenovo-power-conservation` | the only thing that runs as root |
| `install.sh`, `uninstall.sh` | one-time privileged setup, and its removal; `uninstall.sh` also offers to remove the polkit rule |
| `policy/lenovo-power-conservation.rules.example` | optional polkit caching, never installed automatically; copied by hand to `/etc/polkit-1/rules.d/50-lenovo-power-conservation.rules` |
| `upstream.lock` | pinned merge base and fetch coordinates |
| `tools/sync-upstream` | the three-way merge against upstream |
| `tests/` | both suites |

## License

MIT - see `LICENSE`. `Panel.qml` and `Model.js` are Copyright (c) David
Heinemeier Hansson and Omarchy contributors, MIT licensed.
