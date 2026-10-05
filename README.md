# Power - Lenovo Battery Conservation

The first-party power panel - battery icon, charge bar,
cycle count, power profile picker - forked to add Lenovo's battery conservation
mode: the `ideapad_acpi` driver's `conservation_mode` setting, which stops
charging around 80% instead of 100% and slows long-term battery wear on a
machine that spends its life plugged in.

`Panel.qml` is the installed omarchy's power panel plus a battery conservation
section, and `Model.js` is unchanged. Everything this fork adds sits in blocks
marked `// ---------- ... ----------`; the only edit inside code upstream owns is
two methods appended to the existing IPC handler. `manifest.json` is the only
other upstream file this fork changes. `Conservation.js`, `bin/`, `policy/` and
`tests/` are new.

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

`upstream.lock` records the omarchy commit this fork tracks, and that commit is
the common ancestor for every merge.

**It tracks the omarchy you have installed, not the tip of omarchy's branch.**
That is the part worth understanding, because getting it wrong is invisible until
the widget fails to appear.

A cloned first-party panel is not self-contained. It imports types and singleton
members that the shell provides, so panel code from a newer omarchy can
reference API this machine does not have:

| upstream commit | what `Panel.qml` gained | what happens on an older omarchy |
|---|---|---|
| `c231097d` | `ShellIpc`, plus its `qmldir` entry | `ShellIpc is not a type`; the widget never loads and the bar slot is simply empty |
| `b18ab495` | `Style.duration()`, `Style.reduceMotion` | `Style` exists, so these fail as missing members |

Neither produces an error anyone sees. So the order is: **update omarchy first,
then run `tools/sync-upstream`** to advance the pin. Until then, `--check`
reporting drift is correct information rather than an action item, and
`bin/check` fails if the panel ever outruns the shell again.

```bash
tools/sync-upstream --check    # what upstream has done, and what we have, touches nothing
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
  Button { text: root.modeLabel() }   // FORK: ours
||||||| base (upstream 0260d2a)
  Button { }
=======
  Button { text: root.heroStatusText }   // upstream
>>>>>>> upstream (quattro 81145eb1)
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

## Privileged setup

Reading the current mode needs no privilege: `conservation_mode` is
world-readable. Changing it does, because it is owned by root. One command,
once, puts a root-owned helper in place:

```bash
sudo ~/.config/omarchy/plugins/io.github.justfortheloveof.power-lenovo-battery-conservation/install.sh
```

`install.sh` finds its own directory, so the absolute path works from anywhere.
From a clone of this repository, `cd` there and use `sudo ./install.sh`.

That installs exactly one file:

```
/usr/local/libexec/lenovo-power/conservation    root:root, mode 0755
```

Until it is run the panel cannot read the attribute at all, because reading
goes through the same helper: the row says a setup step is needed and the
toggle stays disabled. Once it is installed, reading is silent and needs no
password; only writing prompts. To remove it again, `sudo ./uninstall.sh`.
`omarchy plugin remove` does not: that only knows about files under
`~/.config/omarchy/plugins`.

### Why it is built this way

The installed copy is the only thing this plugin ever asks to be elevated, and
it is deliberately hard to turn into anything else:

- **It takes no path from its caller.** It resolves the kernel attribute
  itself, from a glob fixed inside the script. A caller cannot redirect the
  write.
- **It writes only `0` or `1`.** Everything else is refused before a path is
  resolved or a byte is written.
- **It never re-executes itself.** `set` requires already being root, so a copy
  in a user-writable directory cannot elevate itself. Somebody has to name the
  installed path to `pkexec` on purpose.
- **It reads the attribute back** after writing and fails if the kernel did not
  keep the value, rather than reporting success on the strength of a `write`
  that returned zero.

So a compromised plugin directory buys an attacker exactly two possible writes
to one firmware attribute. That is the whole trust boundary, and it is narrow
enough to state.

`install.sh` reads that helper from the plugin directory, which is
user-writable. That is deliberate: at install time you are trusting the
repository you chose to run. The boundary that matters is at toggle time, and
from then on the root-owned copy is what runs.

### Why polkit and not sudo

Because a bar panel is not a terminal. `sudo` needs a tty to prompt on, so from
a panel it cannot ask you anything. `pkexec` hands the question to polkit, which
hands it to the agent inside `omarchy-shell`, so the prompt is the themed
Omarchy dialog. This is the same reasoning `omarchy-dns` uses when it falls
through to `pkexec`.

Nothing is granted permanently. pkexec uses the stock
`org.freedesktop.policykit.exec` action, which is `auth_admin`, so **every
toggle authenticates**. There is no sudoers entry and no passwordless rule.

If you would rather not type the password on every click, there is an opt-in:

```bash
sudo cp policy/lenovo-power-conservation.rules.example \
     /etc/polkit-1/rules.d/50-lenovo-power-conservation.rules
omarchy-restart-shell
```

It only turns `AUTH_ADMIN` into `AUTH_ADMIN_KEEP` for one exact command line,
`.../conservation set <0|1>`, on a local session, for members of `wheel`.
Nothing else on the system changes, and deleting the file undoes it.

## Using it

Open the Power panel from the battery icon in the bar. Under **POWER PROFILE**
there is now a **BATTERY CONSERVATION** section with one toggle.

The row tells you which state you are in. What it cannot do is make the switch
look unknown: `Toggle` has no indeterminate state, its track is a private id, and
`checked` is a bool, so a row that cannot be read still renders as a normal off
switch. So each state says in words whether that off is a fact or a guess.

| Row shows | Switch | Means |
|---|---|---|
| the real value, enabled | reflects reality | the attribute was read; clicking asks for your password |
| `Current mode unknown. Run sudo ./install.sh...` | off, but a guess | the helper is not installed, so the mode cannot be read at all |
| `No Lenovo conservation_mode attribute here...` | off, and accurate | not an IdeaPad; the mode does not exist here |
| `Current mode unknown: the attribute reported...` | off, but a guess | the attribute exists but reports something this plugin does not know |

A switch reading off while the row calls the mode unknown is the intended
behaviour, not a bug: it is the honest combination available from this
component. Reading is silent and never prompts; only writing prompts.

From a keybinding or a script, over `omarchy-shell`:

```bash
omarchy-shell omarchy.power conservationStatus   # on, off, or unknown
omarchy-shell omarchy.power toggleConservation   # prints the value it asked for
```

`toggleConservation` returns `0` or `1`, the value it asked the kernel to write,
or nothing if it declined. It does not return the result: `pkexec` prompts, so
the write has not happened when it replies. Ask `conservationStatus` again a
moment later for the truth.

## Install

```bash
omarchy plugin add https://github.com/justfortheloveof/omarchy-bar-plugin-power-lenovo-battery-conservation.git --enable
omarchy-restart-shell
```

Only needed to be able to *change* the mode, not to read it:

```bash
sudo ~/.config/omarchy/plugins/io.github.justfortheloveof.power-lenovo-battery-conservation/install.sh
```

Source of truth is this directory. `omarchy plugin add` clones it into
`~/.config/omarchy/plugins/io.github.justfortheloveof.power-lenovo-battery-conservation/`;
never edit there.

```bash
omarchy plugin update io.github.justfortheloveof.power-lenovo-battery-conservation --yes
omarchy plugin remove io.github.justfortheloveof.power-lenovo-battery-conservation --yes   # restores the stock panel
```

## Tests

```bash
node --test tests/conservation.test.cjs   # the logic
node --test tests/helper.test.cjs         # the helper's arguments and writes
```

Neither suite needs root, a Lenovo, or anything in `/sys`. The helper's
privileged path is exercised through `unshare -r`, which maps the caller to uid 0
in a throwaway user namespace; the sysfs glob is rewritten to point at a
temporary tree, so the host is untouched.

## License

MIT - see `LICENSE`.
