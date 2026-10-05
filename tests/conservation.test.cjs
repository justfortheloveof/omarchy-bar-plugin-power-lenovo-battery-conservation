// Unit tests for Conservation.js - run with: node --test tests/conservation.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(`${__dirname}/../Conservation.js`, "utf8"), ctx);
const { resolveAttr, parseState, nextValue, isAcceptedValue, describe } = ctx;

const ATTR = "/sys/bus/platform/drivers/ideapad_acpi/VPC200C:00/conservation_mode";
const ATTR2 = "/sys/bus/platform/drivers/ideapad_acpi/VPC200C:01/conservation_mode";

test("resolveAttr finds the attribute in a glob's matches", () => {
  assert.equal(resolveAttr([ATTR]), ATTR);
  assert.equal(resolveAttr([ATTR, ATTR2]), ATTR, "takes the first match");
});

test("resolveAttr reports no attribute when the glob matched nothing", () => {
  // The ordinary answer on a machine that is not a Lenovo IdeaPad.
  assert.equal(resolveAttr([]), null);
});

test("resolveAttr tolerates absent or malformed match lists", () => {
  assert.equal(resolveAttr(undefined), null);
  assert.equal(resolveAttr(null), null);
  assert.equal(resolveAttr(""), null);
  assert.equal(resolveAttr(42), null);
  assert.equal(resolveAttr({}), null);
});

test("resolveAttr skips blank entries", () => {
  assert.equal(resolveAttr(["", "   ", ATTR]), ATTR);
  assert.equal(resolveAttr(["", "   "]), null);
});

test("resolveAttr refuses a path that is not the conservation attribute", () => {
  // Guards against a stray or hostile glob result being treated as ours.
  assert.equal(resolveAttr(["/sys/bus/platform/drivers/ideapad_acpi/VPC200C:00/input"]), null);
  assert.equal(resolveAttr(["/etc/passwd"]), null);
  assert.equal(resolveAttr(["conservation_mode"]), null, "needs a directory component");
  // Any directory is fine as long as the basename is the attribute: the caller
  // does the globbing, this only vets what came back.
  assert.equal(resolveAttr(["/tmp/conservation_mode"]), "/tmp/conservation_mode");
});

test("parseState maps the two values the attribute can hold", () => {
  assert.equal(parseState("1"), true);
  assert.equal(parseState("0"), false);
});

test("parseState trims what the shell handed over", () => {
  assert.equal(parseState("1\n"), true);
  assert.equal(parseState("  0  \n"), false);
});

test("parseState reports unknown rather than guessing", () => {
  // Unknown must not collapse to false: that would invite a toggle derived
  // from a state nobody actually read.
  assert.equal(parseState("2"), null);
  assert.equal(parseState(""), null);
  assert.equal(parseState("\n"), null);
  assert.equal(parseState("true"), null);
  assert.equal(parseState("01"), null);
  assert.equal(parseState("1 0"), null);
  assert.equal(parseState(null), null);
  assert.equal(parseState(undefined), null);
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
  for (const raw of ["1", "0"]) {
    assert.equal(parseState(nextValue(parseState(raw))), !parseState(raw));
  }
});

test("isAcceptedValue allows only the two exact strings", () => {
  assert.equal(isAcceptedValue("0"), true);
  assert.equal(isAcceptedValue("1"), true);
});

test("isAcceptedValue rejects everything else", () => {
  // This gates the pkexec call, so anything loose here would be loose on the
  // way to root.
  for (const bad of ["", " ", "01", "2", "-1", "0\n", "1 ", true, false, 0, 1, null, undefined, {}]) {
    assert.equal(isAcceptedValue(bad), false, `${JSON.stringify(bad)} must be rejected`);
  }
});

test("isAcceptedValue only ever admits what nextValue produces", () => {
  for (const state of [true, false]) {
    assert.equal(isAcceptedValue(nextValue(state)), true);
  }
});

test("describe reports supported and active when the attribute is present", () => {
  assert.deepEqual({ ...describe([ATTR], "1") }, { supported: true, active: true });
  assert.deepEqual({ ...describe([ATTR], "0") }, { supported: true, active: false });
});

test("describe reports unsupported when the attribute is absent", () => {
  // This is what an HP or any other non-Lenovo machine gets, and raw is null
  // because nothing was read.
  assert.deepEqual({ ...describe([], null) }, { supported: false, active: null });
});

test("describe separates present-but-unknown from absent", () => {
  const unknown = describe([ATTR], "banana");
  assert.equal(unknown.supported, true, "the attribute is there");
  assert.equal(unknown.active, null, "but its value means nothing to us");
});

test("describe ignores a value it was handed when nothing is supported", () => {
  // Defensive: a stale read from a machine that just stopped matching should
  // not leave active=true behind.
  assert.deepEqual({ ...describe([], "1") }, { supported: false, active: null });
});
