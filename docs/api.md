# Local API

Base URL: `http://127.0.0.1:4410`. Run `npm run demo` first. Requests must come from the local machine; the browser uses the same origin as the dashboard.

| Method | Path                | Result                                |
| ------ | ------------------- | ------------------------------------- |
| `GET`  | `/api/health`       | Server health. Does not query Solana. |
| `POST` | `/api/inspect`      | Live mint snapshot.                   |
| `GET`  | `/api/examples`     | Available synthetic examples.         |
| `GET`  | `/api/examples/:id` | Synthetic mint snapshot. No RPC call. |

## Inspect

```sh
curl http://127.0.0.1:4410/api/inspect \
  -H 'Content-Type: application/json' \
  -d '{"address":"So11111111111111111111111111111111111111112","network":"mainnet-beta"}'
```

Both fields are required. `network` accepts `mainnet-beta` or `devnet`; unknown request keys are rejected. The address must decode to a 32-byte Solana public key. Off-curve addresses are allowed.

The local API allows 20 inspection attempts per minute and two concurrent lookups. Requests are limited to 8 KiB; RPC reads to 256 KiB and 10 seconds. A `429` response may include `Retry-After`.

A snapshot includes `version`, `source`, `address`, `network`, `slot`, `observedAt`, `commitment`, `program`, `mintAuthority`, `freezeAuthority`, `supply`, `initialized`, `extensions`, `notes` and the parsed `account`. See the [TypeScript contract](https://github.com/royalpinto007/solana-authority-inspector/blob/main/src/types.ts).

`supply.raw` and `supply.formatted` are strings. Authority values are an address or `null`. Live results use `source: "rpc"`. Examples use `source: "example"`, include `exampleName`, and have `null` slot and observation time.

RPC integers outside JavaScript's safe integer range are preserved as exact decimal strings in `account` and extension state. Other JSON value types are unchanged.

## Errors

Errors use a non-success HTTP status and this shape:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Enter a valid Solana mint address and choose Mainnet or Devnet."
  }
}
```

Handle missing or non-mint accounts, unsupported parsing, invalid input, RPC rate limits, timeouts and network errors. A failed lookup does not establish anything about token safety. There is no transaction submission, custom RPC URL or authentication token.

[Guide](guide.md) · [Architecture](architecture.md)
