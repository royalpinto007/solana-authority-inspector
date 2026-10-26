import { z } from "zod";
import type { Inspection } from "../types.js";
import { InspectorError } from "./errors.js";

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const U64_MAX = 18446744073709551615n;
const UNSIGNED_INTEGER = /^(0|[1-9][0-9]{0,19})$/;
const NATIVE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP",
]);

export function isPublicAddress(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  let decoded = 0n;
  for (const character of value) {
    decoded = decoded * 58n + BigInt(BASE58.indexOf(character));
  }
  let bytes = 0;
  while (decoded > 0n) {
    bytes++;
    decoded >>= 8n;
  }
  let leadingZeroes = 0;
  while (value[leadingZeroes] === "1") leadingZeroes++;
  return bytes + leadingZeroes === 32;
}

export function formatSupply(raw: string, decimals: number): string {
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}

const authority = z.string().refine(isPublicAddress).nullable();
const mintInfo = z.object({
  mintAuthority: authority,
  freezeAuthority: authority,
  supply: z
    .string()
    .refine(
      (value) => UNSIGNED_INTEGER.test(value) && BigInt(value) <= U64_MAX,
    ),
  decimals: z.number().int().min(0).max(255),
  isInitialized: z.boolean(),
  extensions: z
    .array(
      z.object({
        extension: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,79}$/),
        state: z.unknown().optional(),
      }),
    )
    .max(128)
    .optional(),
});

type SnapshotMetadata = Pick<
  Inspection,
  "address" | "network" | "source" | "slot" | "observedAt" | "exampleName"
>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): never {
  throw new InspectorError(
    "RPC_INVALID_RESPONSE",
    "The RPC returned an unexpected account response. Try again.",
  );
}

export function decodeMintAccount(
  account: unknown,
  metadata: SnapshotMetadata,
): Inspection {
  if (account === null) {
    throw new InspectorError(
      "ACCOUNT_NOT_FOUND",
      "No account exists at this address on the selected network.",
      404,
    );
  }
  if (!record(account) || typeof account.owner !== "string") invalidResponse();
  if (account.owner !== TOKEN_PROGRAM && account.owner !== TOKEN_2022) {
    throw new InspectorError(
      "UNSUPPORTED_PROGRAM",
      "This account is not owned by the Token Program or Token-2022.",
      422,
    );
  }
  if (account.executable !== false) invalidResponse();
  if (Array.isArray(account.data)) {
    throw new InspectorError(
      "PARSING_UNAVAILABLE",
      "The RPC could not parse this account as token data.",
      422,
    );
  }
  if (!record(account.data) || !record(account.data.parsed)) invalidResponse();
  if (account.data.parsed.type !== "mint") {
    throw new InspectorError(
      "NOT_A_MINT",
      "This is a token account or another account type. Enter a token mint address.",
      422,
    );
  }
  const parsed = mintInfo.safeParse(account.data.parsed.info);
  if (!parsed.success) invalidResponse();
  const info = parsed.data;
  if (!info.isInitialized) {
    throw new InspectorError(
      "UNINITIALIZED_MINT",
      "This mint has not been initialized.",
      422,
    );
  }
  const notes: string[] = [];
  if (account.owner === TOKEN_2022) {
    notes.push(
      "Token-2022 extensions can add controls beyond mint and freeze authorities. Parsed extensions may not cover every authority or behavior.",
    );
  }
  if (NATIVE_MINTS.has(metadata.address)) {
    notes.push(
      "This is a native wrapped SOL mint. Its recorded mint supply is not the circulating supply of SOL or all wrapped SOL balances.",
    );
  }
  return {
    version: 1,
    ...metadata,
    commitment: "confirmed",
    program: {
      id: account.owner,
      name: account.owner === TOKEN_2022 ? "Token-2022" : "Token Program",
    },
    mintAuthority: info.mintAuthority,
    freezeAuthority: info.freezeAuthority,
    supply: {
      raw: info.supply,
      formatted: formatSupply(info.supply, info.decimals),
      decimals: info.decimals,
    },
    initialized: info.isInitialized,
    extensions: (info.extensions ?? []).map((extension) => ({
      type: extension.extension,
      state: extension.state ?? null,
    })),
    notes,
    account,
  };
}
