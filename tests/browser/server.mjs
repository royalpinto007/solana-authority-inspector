import { createServer } from "node:http";
import { once } from "node:events";
import { createApp } from "../../dist/app.js";

// This HTTP fixture is used only by Playwright. The normal server always reads Solana RPC.
const legacy = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const token2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const wsol = "So11111111111111111111111111111111111111112";
const pyusd = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
const authority = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const rpc = createServer(async (req, res) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  const body = JSON.parse(text);
  const address = body.params[0];
  const native = address === wsol;
  const extensions = address === pyusd;
  const account = {
    owner: extensions ? token2022 : legacy,
    executable: false,
    lamports: 1461600,
    space: extensions ? 320 : 82,
    data: {
      program: extensions ? "spl-token-2022" : "spl-token",
      parsed: {
        type: "mint",
        info: {
          decimals: native ? 9 : 6,
          mintAuthority: native ? null : authority,
          freezeAuthority: native ? null : authority,
          isInitialized: true,
          supply: native ? "0" : "18446744073709551615",
          ...(extensions
            ? {
                extensions: [
                  {
                    extension: "permanentDelegate",
                    state: { delegate: authority },
                  },
                  {
                    extension: "transferHook",
                    state: { authority, programId: null },
                  },
                  {
                    extension: "tokenMetadata",
                    state: {
                      name: '<img src=x onerror="window.pwned=1">',
                      uri: "https://example.invalid/never-fetch",
                    },
                  },
                ],
              }
            : {}),
        },
      },
    },
  };
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: { context: { slot: 123456789 }, value: account },
    }),
  );
});
rpc.listen(0, "127.0.0.1");
await once(rpc, "listening");
const app = createApp({
  fetchImpl: (_url, init) =>
    fetch(`http://127.0.0.1:${rpc.address().port}`, init),
});
const server = app.listen(4420, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    server.closeAllConnections();
    server.close();
    rpc.closeAllConnections();
    rpc.close();
  });
