// Lenovo battery conservation mode.
//
// The kernel exposes this as ideapad_acpi's conservation_mode attribute, a
// root-owned sysfs file holding the literal "1" (stop charging early) or "0"
// (charge normally). Everything here is pure: bin/lenovo-power-conservation is
// the only thing in this plugin that touches the attribute, and all it hands
// back is one word. These functions turn that word into the state the panel
// draws. That keeps the logic testable on any machine, including one with no
// Lenovo in it.
//
// Kept in its own file rather than added to Model.js on purpose. Model.js is
// upstream's, it is covered by upstream's tests, and every line this fork adds
// to it is a line that can conflict when upstream edits it. A file upstream has
// never heard of cannot conflict.

// What bin/lenovo-power-conservation prints for `status`.
//
// "not-installed" comes from the wrapper the panel runs, which checks the helper
// exists before handing over. The rest come from the helper itself.
var NOT_INSTALLED = "not-installed"
var UNSUPPORTED = "unsupported"
var UNKNOWN = "unknown"

var VALUE_OFF = "0"
var VALUE_ON = "1"

// pkexec's exit code when the authentication dialog is dismissed without a
// password. Worth naming: it is the one failure that is not a failure.
var DISMISSED = 126

// Whether a write that did not succeed is worth telling the user about.
//
// 126 means the dialog was dismissed. That is an answer, not a fault: nobody
// typed a password on purpose, the mode is unchanged, and a notification would
// be scolding someone for changing their mind. Any other non-zero exit is worth
// a word, because the toggle looked like it worked and did not.
//
// `errors` is whatever the helper wrote to stderr, and nothing is announced
// without it: a silent non-zero exit has no explanation to pass on.
function shouldNotify(exitCode, errors) {
  var code = Number(exitCode)
  if (code === 0) return false
  if (code === DISMISSED) return false

  var lines = Array.isArray(errors) ? errors : []
  return lines.some(function (line) {
    return String(line || "").trim().length > 0
  })
}

// Normalise whatever the helper printed into the single word we reason about.
function statusWord(raw) {
  if (raw === null || raw === undefined) return ""

  var lines = String(raw).split("\n")
  for (var i = 0; i < lines.length; i++) {
    var word = lines[i].trim()
    if (word) return word
  }

  return ""
}

// Read the word for what the mode is doing.
//
// true when conservation is on, false when off, null when this says nothing
// useful: not installed, no such machine, or a value the kernel reported that
// we do not recognise. Null is deliberately not false. Treating an unreadable
// state as "off" would invite a toggle derived from a value nobody read.
function parseState(word) {
  var value = String(word || "").trim()
  if (value === VALUE_ON) return true
  if (value === VALUE_OFF) return false
  return null
}

// Everything the panel needs to know, from one word.
//
// `installed` and `supported` are separate on purpose. A machine with no
// Lenovo attribute is not broken and nothing needs fixing; a helper that was
// never installed is a setup step we can tell the user about.
function describe(raw) {
  var word = statusWord(raw)
  var installed = word !== "" && word !== NOT_INSTALLED
  var supported = installed && word !== UNSUPPORTED

  return {
    installed: installed,
    supported: supported,
    active: supported ? parseState(word) : null,
  };
}

// The value that turns conservation mode into `active`.
//
// Opposite of what is asked for, so toggling is nextValue(state). Returns null
// for an unknown state: writing a value derived from a state we could not read
// would be guessing.
function nextValue(active) {
  if (active === true) return VALUE_OFF;
  if (active === false) return VALUE_ON;
  return null;
}

// Whether a value is one this plugin will ever send to the kernel.
//
// Only the two exact strings. This runs before pkexec is ever invoked, so the
// helper's own check is a second line of defence rather than the only one.
function isAcceptedValue(value) {
  return value === VALUE_OFF || value === VALUE_ON;
}

// Which row the panel's cursor lands on for a vertical move.
//
// This panel has one focusable row of its own - the profile buttons - and ours
// sits below it, so vertical movement alternates between them. There is no
// section string to keep in sync: `focused` is simply "the cursor is on our row
// rather than on the profiles", the same plain boolean the panel already uses
// for cursorActive.
//
// `available` is the row being reachable at all. When the helper is missing, or
// the mode has not been read, the row would refuse to do anything, so it is
// left out of the walk rather than made into a cursor stop that fails.
// `hasProfiles` says whether the profile row is there to move to; with no
// profiles at all, the only vertical move lands on ours.
//
// Moving past either end stays put. Wrapping would silently change a profile
// while the user is reaching for a toggle, and the panel's own profile index
// does not wrap either - Model.clampIndex pins it.
function moveFocusRow(focused, delta, available, hasProfiles) {
  if (available !== true) return focused === true

  // Down always lands on our row, which is the last thing below the profiles.
  // With no profiles to start from there is nowhere else it could mean.
  if (delta > 0) return true

  // Up leaves our row for the profiles, and stops on ours when there are none,
  // because descending to a row that is not on screen is not a move.
  if (delta < 0) return hasProfiles === true ? false : true

  return focused
}

// Whether the conservation row should claim the cursor when hovered.
//
// Hover is the mouse's way of saying "I am pointing at this row", so it moves
// the cursor only when that row would also accept a keyboard activation.
// Otherwise hovering a row that cannot be toggled would strand the cursor off
// the profiles with nothing for Return to do.
function hoverClaimsFocus(available) {
  return available === true
}

if (typeof module !== "undefined") {
  module.exports = {
    statusWord: statusWord,
    parseState: parseState,
    describe: describe,
    nextValue: nextValue,
    isAcceptedValue: isAcceptedValue,
    shouldNotify: shouldNotify,
    moveFocusRow: moveFocusRow,
    hoverClaimsFocus: hoverClaimsFocus,
  };
}
