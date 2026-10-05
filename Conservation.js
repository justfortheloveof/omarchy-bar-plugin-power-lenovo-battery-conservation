// Lenovo battery conservation mode.
//
// The kernel exposes this as ideapad_acpi's conservation_mode attribute, a
// root-owned sysfs file holding the literal "1" (stop charging early) or "0"
// (charge normally). Everything here is pure: the caller does the globbing and
// the reading, and these functions only interpret what it hands over. That
// keeps the logic testable on any machine, including one with no Lenovo in it.
//
// Kept in its own file rather than added to Model.js on purpose. Model.js is
// upstream's, it is covered by upstream's tests, and every line this fork adds
// to it is a line that can conflict when upstream edits it. A file upstream has
// never heard of cannot conflict.

// The attribute's basename. Anything else is not ours to read or write.
var ATTR_NAME = "conservation_mode";

// Pick the conservation_mode path out of a glob's matches.
//
// Returns null when there is no candidate, which is the normal answer on any
// machine that is not a Lenovo IdeaPad: the panel shows the row as
// unsupported rather than failing.
function resolveAttr(paths) {
  if (!Array.isArray(paths)) return null;

  for (var i = 0; i < paths.length; i++) {
    var candidate = String(paths[i] || "").trim();
    if (!candidate) continue;
    // Require an absolute path ending in /conservation_mode. The basename
    // check keeps a stray or hostile glob result from being mistaken for the
    // attribute; requiring the leading slash rules out a bare name, which as
    // root would resolve against whatever directory the helper was run from.
    if (candidate.slice(-(ATTR_NAME.length + 1)) !== "/" + ATTR_NAME) continue;
    return candidate;
  }

  return null;
}

// Read the attribute's current contents.
//
// true when conservation is on, false when off, null when the value is
// anything this code does not recognise. Null is deliberately not false: an
// unrecognised value means the state is unknown, and treating that as "off"
// would invite a toggle that flips a setting nobody has actually read.
function parseState(raw) {
  if (raw === null || raw === undefined) return null;

  var value = String(raw).trim();
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

// The value that turns conservation mode into `active`.
//
// Opposite of what is asked for, so toggling is nextValue(state). Returns null
// for an unknown state: writing a value derived from a state we could not read
// would be guessing.
function nextValue(active) {
  if (active === true) return "0";
  if (active === false) return "1";
  return null;
}

// Whether a value is one this plugin will ever send to the kernel.
//
// Only the two exact strings. This runs before pkexec is ever invoked, so the
// privileged helper's own check is a second line of defence rather than the
// only one.
function isAcceptedValue(value) {
  return value === "0" || value === "1";
}

// Supported and current state in one call.
//
// `active` is null both when the attribute is absent (nothing to report) and
// when its contents were unrecognised (present, but unknown). The panel tells
// those two apart by checking `supported` first.
function describe(paths, raw) {
  var supported = resolveAttr(paths) !== null;
  return {
    supported: supported,
    active: supported ? parseState(raw) : null,
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    resolveAttr: resolveAttr,
    parseState: parseState,
    nextValue: nextValue,
    isAcceptedValue: isAcceptedValue,
    describe: describe,
  };
}
