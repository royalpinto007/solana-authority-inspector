import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("CLI describes usage and rejects invalid ports before starting a server", () => {
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        new URL("../src/cli.ts", import.meta.url).pathname,
        ...args,
      ],
      { encoding: "utf8", timeout: 5000 },
    );
  const help = run(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /solana-authority-inspector/);
  const version = run(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), "0.1.0");
  for (const args of [
    ["--port", "0"],
    ["--port", "65536"],
    ["--port", ""],
    ["--port", "1.2"],
    ["--rpc", "http://example.com"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1, result.stderr);
  }
});
