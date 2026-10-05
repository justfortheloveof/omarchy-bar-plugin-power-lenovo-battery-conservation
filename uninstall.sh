#!/bin/bash
#
# Remove what install.sh put in place.
#
#   sudo ./uninstall.sh
#
# Removing the plugin with `omarchy plugin remove` does not do this: that
# command only knows about files under ~/.config/omarchy/plugins.

set -euo pipefail

readonly PACKAGED_DIR=/usr/local/libexec/lenovo-power
readonly PACKAGED_PATH="$PACKAGED_DIR/conservation"

readonly RULES_PATH=/etc/polkit-1/rules.d/50-lenovo-power-conservation.rules

die() {
	printf 'uninstall.sh: %s\n' "$1" >&2
	exit 1
}

((EUID == 0)) || die "run this with sudo: sudo $0"

if [[ ! -e $PACKAGED_PATH ]]; then
	printf 'Nothing installed at %s\n' "$PACKAGED_PATH"
else
	# Refuse to delete a file we cannot identify. The path is plugin-specific,
	# but this is a root-owned rm and the check costs one grep.
	if ! grep -qF 'lenovo-power-conservation: installed by' "$PACKAGED_PATH"; then
		die "$PACKAGED_PATH does not look like our helper; leaving it alone"
	fi

	rm -f "$PACKAGED_PATH"
	printf 'Removed %s\n' "$PACKAGED_PATH"
fi

rmdir "$PACKAGED_DIR" 2>/dev/null && printf 'Removed %s\n' "$PACKAGED_DIR"

# This script never installs the rules file, but the README offers it as an
# option, so say if one is there.
if [[ -e $RULES_PATH ]]; then
	printf '\nAlso present, and not ours to delete without a look:\n  %s\n' "$RULES_PATH"
	printf 'Remove it yourself if you no longer want the authorisation cached.\n'
fi

printf '\nDone. The panel will now read the current mode but refuse to change it.\n'
