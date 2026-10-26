#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parsePort } from "./config.js";

try {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      port: { type: "string" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log(`Solana Authority Inspector

Usage: solana-authority-inspector [--port 4410]

  --port         Local port (default: PORT or 4410)
  -h, --help     Show this help
  -v, --version  Show the package version

Open the printed localhost URL. Read-only; no wallet or funds required.`);
  } else if (values.version) {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    console.log(pkg.version);
  } else {
    if (values.port !== undefined)
      process.env.PORT = String(parsePort(values.port));
    await import("./server.js");
  }
} catch (error) {
  console.error(
    `Solana Authority Inspector: ${error instanceof Error ? error.message : "Cannot start."}`,
  );
  process.exitCode = 1;
}
