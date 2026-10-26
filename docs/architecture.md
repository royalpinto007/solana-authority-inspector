# Architecture

One local Node.js process serves the dashboard and a small read-only API. The browser never connects directly to Solana RPC.

![Browser, local API and Solana RPC flow](architecture.svg)

## A live inspection

1. The browser sends a mint address and network to `POST /api/inspect`.
2. Express checks the request, address and network. Only fixed official RPC endpoints are allowed.
3. The RPC adapter calls `getAccountInfo` with `jsonParsed` encoding and `confirmed` commitment.
4. The decoder verifies the account owner, mint type and required fields, then preserves supply as an integer string.
5. The dashboard renders the snapshot and can export the same data as JSON.

Examples pass synthetic account fixtures through the same decoder and are explicitly marked `source: "example"`.

## Boundaries

| Area            | Responsibility                                           |
| --------------- | -------------------------------------------------------- |
| `src/web/`      | Accessible interface, recent addresses, copy and export. |
| `src/domain/`   | Address validation and mint decoding.                    |
| `src/adapters/` | Bounded read-only RPC requests.                          |
| `src/app.ts`    | HTTP validation, local access checks and errors.         |
| `src/server.ts` | Loopback listener and startup.                           |

The server has no database or durable storage. Browser history contains at most eight addresses. Request size, upstream response size, timeouts, concurrency and rate limits bound the work per lookup. Hosts and origins are restricted to local access.

Only account state is inspected. Token-2022 extensions are exposed as parsed data, not a complete audit. There is no transaction submission, wallet access, metadata fetching or safety score.

[Guide](guide.md) · [Local API](api.md) · [RPC reference](https://solana.com/docs/rpc/http/getaccountinfo)
