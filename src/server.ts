import { createApp } from "./app.js";
import { parsePort } from "./config.js";

try {
  const port = parsePort(process.env.PORT);
  const app = createApp();
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`Solana Authority Inspector: http://127.0.0.1:${port}`);
    console.log("Read-only. No wallet, keys or funds required.");
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `Port ${port} is in use. Choose another PORT.`
        : "Could not start the local server.",
    );
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      server.close();
      server.closeIdleConnections();
      setTimeout(() => server.closeAllConnections(), 3000).unref();
    });
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Could not start the local server.",
  );
  process.exitCode = 1;
}
