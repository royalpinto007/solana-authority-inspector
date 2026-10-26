# Read a mint, understand its controls

Paste a **token mint address**, choose Mainnet or Devnet, then select **Inspect mint**. A wallet address or token account is not a mint. Addresses are public; no wallet connection or signature is required.

## Read the fields

| Field                  | What it means                                                         |
| ---------------------- | --------------------------------------------------------------------- |
| Mint authority         | The address allowed to create more units of this token.               |
| Freeze authority       | The address allowed to freeze or thaw token accounts for this mint.   |
| Token program          | The program that owns the mint: Token Program or Token-2022.          |
| Supply                 | The mint's raw integer supply, displayed using its decimal precision. |
| Slot and observed time | The RPC context slot and the time your server received the snapshot.  |

**No authority set** means the field is currently empty. This lookup does not read history, so it cannot tell you whether an authority was revoked or never assigned. An authority address may belong to a multisig or program; its control structure is not resolved here. [Solana authority documentation](https://solana.com/docs/tokens/basics/set-authority).

## Token-2022 needs a closer look

Extensions may introduce fees, delegates, hooks or additional authorities. Expand the extension data to read the state returned by the RPC parser. The inspector does not interpret every extension or resolve external programs. Empty base authority fields do not prove that no other controls exist. [Token extensions](https://solana.com/docs/tokens/extensions).

**Native wrapped SOL is special.** The classic native mint `So11111111111111111111111111111111111111112` and Token-2022 native mint `9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP` do not report circulating wrapped SOL through their mint supply field. [Wrapped SOL](https://solana.com/docs/tokens/basics/sync-native).

## Save the evidence

**Export JSON** downloads the displayed snapshot, including network, source, authorities, exact supply and parsed account response. Raw supply stays a string. RPC integers too large for JavaScript's safe integer range also become exact decimal strings, preserving extension values and account fields. Decimal formatting does not apply extension-specific interest or scaled display rules.

**Offline examples are synthetic.** They teach the interface without an RPC call. Their exports use `source: "example"`, with no observed time or slot. They are not evidence about an address on chain.

## Privacy and limits

- The app runs on your computer. Live lookups send the mint address to the selected official public Solana RPC endpoint.
- Up to eight recent lookup addresses stay in your browser. The server does not persist lookups.
- No token logos, metadata URLs, prices, analytics or other remote content are fetched automatically.
- Public RPCs can throttle or fail. Wait and retry; switching networks also changes which chain state you query.
- Results use `confirmed` commitment. State may change after inspection; rerun to refresh.
- Unsupported parsing, missing accounts and non-mint accounts produce an error instead of a guess.

This is an educational account-state viewer. It does not assess liquidity, ownership concentration, project identity, market value or token safety.

[Architecture](architecture.md) · [Local API](api.md) · [Solana getAccountInfo](https://solana.com/docs/rpc/http/getaccountinfo)
