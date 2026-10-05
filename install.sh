#!/bin/bash
#
# Install the root-owned half of the Lenovo power plugin.
#
# The panel reads conservation mode unprivileged, so it works the moment the
# plugin is enabled. Writing it does not: the kernel attribute is root-owned,
# and the only thing this plugin will ever ask to be elevated is the copy of
# bin/lenovo-power-conservation that this script puts here.
#
# Run once, with sudo. Nothing else in the plugin needs privilege.
#
#   sudo ./install.sh
#   sudo ./uninstall.sh    # to remove it again

set -euo pipefail

readonly PACKAGED_DIR=/usr/local/libexec/lenovo-power
readonly PACKAGED_PATH="$PACKAGED_DIR/conservation"

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
readonly SCRIPT_DIR
readonly SOURCE_PATH="$SCRIPT_DIR/bin/lenovo-power-conservation"

die() {
	printf 'install.sh: %s\n' "$1" >&2
	exit 1
}

((EUID == 0)) || die "run this with sudo: sudo $0"

[[ -f $SOURCE_PATH ]] || die "cannot find $SOURCE_PATH"

# Not fatal. Installing on a machine without the attribute is how you find out
# the panel says "unsupported" rather than failing to load.
if ! compgen -G '/sys/bus/platform/drivers/ideapad_acpi/*/conservation_mode' >/dev/null; then
	printf 'Warning: no ideapad_acpi conservation_mode attribute on this machine.\n' >&2
	printf '         The panel will report the toggle as unsupported.\n' >&2
fi

if [[ -e $PACKAGED_PATH ]]; then
	printf 'Replacing the existing %s\n' "$PACKAGED_PATH"
fi

install -d -m 0755 -o root -g root "$PACKAGED_DIR"
# Mode 0755, not 0750: pkexec authenticates the user and then execs this, so it
# has to be traversable and executable by them. It is not writable by them.
install -m 0755 -o root -g root "$SOURCE_PATH" "$PACKAGED_PATH"

# Confirm what actually landed rather than trusting install's exit status: this
# file is about to be run as root, so its ownership and mode are the security
# properties that matter.
owner=$(stat -Lc '%U' "$PACKAGED_PATH") || die "cannot stat $PACKAGED_PATH"
mode=$(stat -Lc '%a' "$PACKAGED_PATH") || die "cannot stat $PACKAGED_PATH"

[[ $owner == root ]] || die "$PACKAGED_PATH is owned by $owner, expected root"
((8#$mode & 022)) && die "$PACKAGED_PATH is mode $mode, which lets someone other than root modify it"

if ! grep -qF 'lenovo-power-conservation: installed by' "$PACKAGED_PATH"; then
	die "$PACKAGED_PATH does not look like our helper; refusing to leave it in place"
fi

printf '\nInstalled %s (%s, mode %s)\n' "$PACKAGED_PATH" "$owner" "$mode"
printf '\nThe panel can read the current mode now. Writing it asks for your\n'
printf 'password once per toggle, through the Omarchy authentication dialog.\n'
printf '\nReload the shell, or remove and re-add the widget, to pick it up:\n'
printf '  omarchy-restart-shell\n'