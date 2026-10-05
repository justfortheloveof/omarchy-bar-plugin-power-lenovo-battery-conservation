// Tests for bin/lenovo-power-conservation - run with:
//   node --test tests/helper.test.cjs
//
// The helper hardcodes its sysfs glob and its installed path, both on purpose,
// so the tests work on a copy with those two constants rewritten to point into a
// temporary tree. What is under test is the argument validation, the value
// parsing and the read-back, not the literal paths.
//
// The write path needs to look like root, which is what `unshare -r` is for: a
// user namespace where the caller is uid 0. That exercises the real privileged
// branch, including the PATH pin and the read-back, without root on the host and
// without touching /sys.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HELPER = path.join(__dirname, "..", "bin", "lenovo-power-conservation");

// Build a helper wired to a throwaway "sysfs" and report back a runner.
//
// `value` seeds the fake attribute; pass undefined to leave it absent.
function harness({ value } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lenovo-power-"));
  const sysfs = path.join(root, "sys", "bus", "platform", "drivers", "ideapad_acpi", "VPC200C:00");
  const attr = path.join(sysfs, "conservation_mode");
  const packagedDir = path.join(root, "libexec", "lenovo-power");

  fs.mkdirSync(sysfs, { recursive: true });
  fs.mkdirSync(packagedDir, { recursive: true });
  if (value !== undefined) fs.writeFileSync(attr, value);

  // Rewrite the two constants so the copy looks at our tree instead of /sys.
  // Everything else in the script is the code under test.
  const script = path.join(root, "helper");
  const rewritten = fs
    .readFileSync(HELPER, "utf8")
    .replace(/^readonly PACKAGED_PATH=.*$/m, `readonly PACKAGED_PATH=${packagedDir}/conservation`)
    .replace(
      /^readonly ATTR_GLOB=.*$/m,
      `readonly ATTR_GLOB='${root}/sys/bus/platform/drivers/ideapad_acpi/*/conservation_mode'`
    );
  fs.writeFileSync(script, rewritten, { mode: 0o755 });

  const run = (args, { asRoot = false } = {}) => {
    // The rewritten copy, not HELPER: the real one reads the real /sys.
    const res = asRoot
      ? spawnSync("unshare", ["-r", script, ...args], { encoding: "utf8" })
      : spawnSync(script, [...args], { encoding: "utf8" });
    if (res.error) throw res.error;
    return { code: res.status, out: res.stdout.trim(), err: res.stderr.trim() };
  };

  return { run, attr, root };
}

test("status on a machine with no attribute reports unsupported", () => {
  // This is what an HP, or any other non-Lenovo, gets. Exit 3, not a failure.
  const { run } = harness();
  const r = run(["status"]);
  assert.equal(r.code, 3);
  assert.equal(r.out, "unsupported");
});

test("status reads both values the attribute can hold", () => {
  for (const [seed, expected] of [["1", "1"], ["0", "0"]]) {
    const { run } = harness({ value: seed });
    const r = run(["status"]);
    assert.equal(r.code, 0);
    assert.equal(r.out, expected);
  }
});

test("status tolerates a trailing newline in the attribute", () => {
  const { run } = harness({ value: "1\n" });
  assert.equal(run(["status"]).out, "1");
});

test("status reports an unrecognised value as unknown, not as off", () => {
  // Exit 4 and the word "unknown": a caller that cannot read the state must not
  // conclude it is off, or a toggle would be derived from a guess.
  for (const seed of ["2", "", "banana", "01"]) {
    const { run } = harness({ value: seed });
    const r = run(["status"]);
    assert.equal(r.code, 4, `"${seed}" should be unknown`);
    assert.equal(r.out, "unknown");
  }
});

test("status takes no arguments", () => {
  const { run } = harness({ value: "0" });
  assert.equal(run(["status", "1"]).code, 2);
});

test("set is refused without root, and says what to run instead", () => {
  const { run, attr } = harness({ value: "0" });
  const r = run(["set", "1"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /needs root/);
  assert.match(r.err, /pkexec/, "the error should name the command to run");
  assert.equal(fs.readFileSync(attr, "utf8"), "0", "and it must not have written anything");
});

test("set rejects anything that is not exactly 0 or 1", () => {
  // The entire validation surface. Each of these would be a different thing to
  // hand to a root shell if it got through.
  const bad = [
    ["2"],
    ["-1"],
    ["01"],
    [""],
    [" "],
    ["1 "],
    [" 1"],
    ["1\n"],
    ["0; rm -rf /"],
    ["$(id)"],
    ["`id`"],
    ["1 && reboot"],
    ["0|0"],
    ["true"],
    ["1.0"],
  ];
  for (const args of bad) {
    const { run, attr } = harness({ value: "0" });
    const r = run(["set", ...args], { asRoot: true });
    assert.equal(r.code, 2, `set ${JSON.stringify(args[0])} should be refused`);
    assert.equal(fs.readFileSync(attr, "utf8"), "0", `set ${JSON.stringify(args[0])} must not write`);
  }
});

test("set takes exactly one argument", () => {
  for (const args of [[], ["0", "1"], ["0", "extra"], ["0", "1", "2"]]) {
    const { run } = harness({ value: "0" });
    assert.equal(run(["set", ...args], { asRoot: true }).code, 2, `set ${args.length} args`);
  }
});

test("set writes both values when root", () => {
  for (const target of ["1", "0"]) {
    const { run, attr } = harness({ value: target === "1" ? "0" : "1" });
    const r = run(["set", target], { asRoot: true });
    assert.equal(r.code, 0, `set ${target} should succeed`);
    assert.equal(r.out, target);
    assert.equal(fs.readFileSync(attr, "utf8"), target);
  }
});

test("set writes without a trailing newline", () => {
  // sysfs attributes are written bare; a newline would be part of the value.
  const { run, attr } = harness({ value: "0" });
  assert.equal(run(["set", "1"], { asRoot: true }).code, 0);
  assert.equal(fs.readFileSync(attr, "utf8"), "1");
});

test("set refuses when there is no attribute to write", () => {
  const { run } = harness();
  const r = run(["set", "1"], { asRoot: true });
  assert.equal(r.code, 3);
  assert.match(r.err, /no conservation_mode attribute/);
});

test("the helper checks the write instead of trusting it", () => {
  // Not behavioural: making a write fail needs a sysfs attribute that refuses a
  // value, and a plain file cannot be one. Inside `unshare -r` we are root in
  // the namespace, so file modes do not stop us either (chattr +i and a
  // read-only bind mount are both denied here).
  //
  // So assert the check is present, which fails loudly if it is ever dropped:
  // the helper re-reads what it wrote and errors if the kernel did not keep it.
  const source = fs.readFileSync(HELPER, "utf8");
  assert.match(source, /cat -- "\$path"/, "should read the attribute back");
  assert.match(source, /\[\[ \$confirm != "\$value" \]\]/, "should compare what came back");
});

test("an unknown subcommand is refused", () => {
  const { run } = harness({ value: "0" });
  for (const args of [[], ["help"], ["--help"], ["-h"], ["SET", "1"], ["Status"], [""]]) {
    const r = run(args);
    assert.equal(r.code, 2, `${JSON.stringify(args)} should be a usage error`);
  }
});

test("subcommands are case sensitive and take no flags", () => {
  const { run } = harness({ value: "0" });
  for (const args of [["--status"], ["status", "--json"], ["set", "--", "1"]]) {
    assert.equal(run(args, { asRoot: true }).code, 2, `${JSON.stringify(args)}`);
  }
});

test("the helper carries the marker uninstall.sh looks for", () => {
  // If this drifts, uninstall.sh refuses to delete the file and leaves it in
  // place. Keeping them tied together is the point.
  const source = fs.readFileSync(HELPER, "utf8");
  assert.match(source, /lenovo-power-conservation: installed by/);
});

test("the privileged files name where they came from", () => {
  // These two are the only files that land outside the repository: the helper
  // in /usr/local/libexec, the rules example in /etc/polkit-1/rules.d. Once
  // installed, nothing about either tells a sysadmin where to find the source,
  // so both have to say so themselves.
  //
  // install.sh and uninstall.sh are deliberately not in this list: they run
  // from the repository and leave nothing behind, so nobody reads them on the
  // installed system.
  const repo = "https://github.com/justfortheloveof/omarchy-bar-plugin-power-lenovo-battery-conservation";

  for (const f of [
    "bin/lenovo-power-conservation",
    "policy/lenovo-power-conservation.rules.example",
  ]) {
    const text = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.ok(text.includes(repo), `${f} should name ${repo}`);
  }
});

test("the helper says how to remove it", () => {
  // A root-owned file with no recorded uninstall route is the failure mode this
  // is guarding against, so the removal path has to be in the file too.
  const source = fs.readFileSync(HELPER, "utf8");
  assert.match(source, /uninstall\.sh/, "should name uninstall.sh");
  assert.match(source, /keeps no state/, "should say it is safe to delete");
});

test("install.sh, uninstall.sh and the helper agree on the installed path", () => {
  // If these drift, the panel elevates a path that does not exist or uninstall
  // deletes the wrong file. Each script composes the full path from a directory
  // constant, so compare the directory and the basename rather than a literal.
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const dirOf = (source) => {
    const m = source.match(/^readonly PACKAGED_DIR=(.*)$/m) || source.match(/^PACKAGED_DIR=(.*)$/m);
    assert.ok(m, "the script should define PACKAGED_DIR");
    return m[1].replace(/^["']|["']$/g, "");
  };

  const expectedDir = "/usr/local/libexec/lenovo-power";
  for (const f of ["install.sh", "uninstall.sh"]) {
    assert.equal(dirOf(read(f)), expectedDir, `${f} installs somewhere else`);
    assert.match(read(f), /conservation"/, `${f} should name the helper file`);
  }

  // The helper spells its own path out in full.
  assert.match(
    read("bin/lenovo-power-conservation"),
    /^readonly PACKAGED_PATH=\/usr\/local\/libexec\/lenovo-power\/conservation$/m
  );
});

test("the rules example only widens our own command line", () => {
  // A stray YES in this file would hand out far more than one toggle.
  const rules = fs.readFileSync(
    path.join(__dirname, "..", "policy", "lenovo-power-conservation.rules.example"),
    "utf8"
  );
  assert.ok(!/polkit\.Result\.YES/.test(rules), "must never grant without authentication");
  assert.match(rules, /conservation set \[01\]/, "must match only the exact write");
  assert.match(rules, /isInGroup\("wheel"\)/);
  assert.match(rules, /subject\.local/);
});

test("the shipped rules example is not installed by install.sh", () => {
  const install = fs.readFileSync(path.join(__dirname, "..", "install.sh"), "utf8");
  assert.ok(
    !/rules\.d|rules\.example/.test(install),
    "install.sh must not copy the rules file into /etc without being asked"
  );
});
