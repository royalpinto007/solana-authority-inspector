import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

export const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export function mintAccount() {
  return {
    owner: TOKEN_PROGRAM,
    executable: false,
    lamports: 1461600,
    space: 82,
    data: {
      program: "spl-token",
      parsed: {
        type: "mint",
        info: {
          mintAuthority: null as string | null,
          freezeAuthority: null as string | null,
          supply: "18446744073709551615",
          decimals: 6,
          isInitialized: true,
          extensions: [] as { extension: string; state?: unknown }[],
        },
      },
    },
  };
}

export function rpcResult(account: unknown = mintAccount()) {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: { context: { slot: 321 }, value: account },
  };
}

export async function fixtureRpc(handler: (response: ServerResponse) => void) {
  const requests: { target: string; body: unknown }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    requests.push({
      target: request.url ?? "",
      body: JSON.parse(body) as unknown,
    });
    handler(response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const targets: string[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    targets.push(String(input));
    return fetch(endpoint, init);
  };
  return {
    requests,
    targets,
    fetchImpl,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}
