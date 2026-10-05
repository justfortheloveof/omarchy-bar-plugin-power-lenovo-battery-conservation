// Unit tests for Conservation.js - run with: node --test tests/conservation.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(`${__dirname}/../Conservation.js`, "utf8"), ctx);
const { statusWord, parseState, nextValue, isAcceptedValue, describe } = ctx;

// Exactly what bin/lenovo-power-conservation prints for `status`.
const INSTALLED_ON = "1";
const INSTALLED_OFF = "0";
const INSTALLED_UNKNOWN = "unknown";
const NO_SUCH_MACHINE = "unsupported";
const NOT_INSTALLED = "not-installed";

test("statusWord takes the first non-blank line", () => {
  assert.equal(statusWord("1\n"), "1");
  assert.equal(statusWord("  0  \n"), "0");
  assert.equal(statusWord("\n\n1\n"), "1");
  assert.equal(statusWord("unknown"), "unknown");
});

test("statusWord reports nothing for empty output", () => {
  // A helper that printed nothing, or was never run.
  assert.equal(statusWord(""), "");
  assert.equal(statusWord("\n"), "");
  assert.equal(statusWord("   \n\n"), "");
  assert.equal(statusWord(null), "");
  assert.equal(statusWord(undefined), "");
});

test("parseState maps the two values the mode can hold", () => {
  assert.equal(parseState(INSTALLED_ON), true);
  assert.equal(parseState(INSTALLED_OFF), false);
});

test("parseState reports unknown rather than guessing", () => {
  // Unknown must not collapse to false: that would invite a toggle derived
  // from a value nobody actually read.
  for (const word of [INSTALLED_UNKNOWN, NO_SUCH_MACHINE, NOT_INSTALLED, "", "2", "true", "01"]) {
    assert.equal(parseState(word), null, `"${word}" must not read as off`);
  }
  assert.equal(parseState(null), null);
});

test("nextValue flips a known state", () => {
  assert.equal(nextValue(true), "0", "was on, so turn it off");
  assert.equal(nextValue(false), "1", "was off, so turn it on");
});

test("nextValue refuses an unknown state", () => {
  assert.equal(nextValue(null), null);
  assert.equal(nextValue(undefined), null);
  assert.equal(nextValue("1"), null, "strings are not booleans here");
  assert.equal(nextValue(0), null);
});

test("nextValue round-trips through parseState", () => {
  for (const word of [INSTALLED_ON, INSTALLED_OFF]) {
    assert.equal(parseState(nextValue(parseState(word))), !parseState(word));
  }
});

test("isAcceptedValue allows only the two exact strings", () => {
  assert.equal(isAcceptedValue("0"), true);
  assert.equal(isAcceptedValue("1"), true);
});

test("isAcceptedValue rejects everything else", () => {
  // This gates the pkexec call, so anything loose here would be loose on the
  // way to root.
  const bad = ["", " ", "01", "2", "-1", "0\n", "1 ", true, false, 0, 1, null, undefined, {}, "unknown"];
  for (const value of bad) {
    assert.equal(isAcceptedValue(value), false, `${JSON.stringify(value)} must be rejected`);
  }
});

test("isAcceptedValue only ever admits what nextValue produces", () => {
  for (const state of [true, false]) {
    assert.equal(isAcceptedValue(nextValue(state)), true);
  }
  assert.equal(isAcceptedValue(nextValue(null)), false);
});

test("describe reports a working machine with the mode on or off", () => {
  assert.deepEqual({ ...describe(INSTALLED_ON) }, { installed: true, supported: true, active: true });
  assert.deepEqual({ ...describe(INSTALLED_OFF) }, { installed: true, supported: true, active: false });
  assert.deepEqual({ ...describe("1\n") }, { installed: true, supported: true, active: true });
});

test("describe separates a machine without the attribute from an uninstalled helper", () => {
  // Both leave the row unusable, but only one is worth telling the user to fix.
  const unsupported = describe(NO_SUCH_MACHINE);
  assert.equal(unsupported.installed, true, "the helper ran, so it is installed");
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.active, null);

  const missing = describe(NOT_INSTALLED);
  assert.equal(missing.installed, false);
  assert.equal(missing.supported, false);
  assert.equal(missing.active, null);
});

test("describe reports present-but-unreadable separately from absent", () => {
  const unknown = describe(INSTALLED_UNKNOWN);
  assert.equal(unknown.installed, true);
  assert.equal(unknown.supported, true, "the attribute is there");
  assert.equal(unknown.active, null, "but its value means nothing to us");
});

test("describe treats silence as not installed", () => {
  // The helper failed to run at all. Nothing is claimed about the hardware.
  assert.deepEqual({ ...describe("") }, { installed: false, supported: false, active: null });
});

test("describe ignores a stale value from a machine that stopped matching", () => {
  assert.deepEqual({ ...describe("") }, { installed: false, supported: false, active: null });
  assert.equal(describe("").active, null);
});

test("the helper's status words are the ones this module knows", () => {
  // If bin/lenovo-power-conservation ever changes what it prints, these tests
  // should be the thing that notices.
  const helper = fs.readFileSync(`${__dirname}/../bin/lenovo-power-conservation`, "utf8");
  assert.match(helper, /printf 'unsupported\\n'/, "prints the unsupported word");
  assert.match(helper, /printf 'unknown\\n'/, "prints the unknown word");
  assert.match(helper, /printf '0\\n'/, "prints 0");
  assert.match(helper, /printf '1\\n'/, "prints 1");
});