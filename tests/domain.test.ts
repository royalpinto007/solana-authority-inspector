import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeMintAccount,
  formatSupply,
  isPublicAddress,
} from "../src/domain/mint.js";
import { InspectorError } from "../src/domain/errors.js";
import { MINT, TOKEN_2022, mintAccount } from "./helpers/rpc.js";

const metadata = {
  address: MINT,
  network: "mainnet-beta" as const,
  source: "rpc" as const,
  slot: 321,
  observedAt: "2026-01-01T00:00:00.000Z",
};

function throwsCode(action: () => unknown, code: string) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof InspectorError);
    assert.equal(error.code, code);
    return true;
  });
}

test("public address validation requires exactly 32 decoded bytes, including off-curve addresses", () => {
  for (const address of [
    MINT,
    "11111111111111111111111111111111",
    TOKEN_2022,
  ]) {
    assert.equal(isPublicAddress(address), true, address);
  }
  for (const address of [
    "",
    "0".repeat(32),
    "1".repeat(31),
    "1".repeat(33),
    "z".repeat(44),
    ` ${MINT}`,
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test("supply formatting preserves u64 precision and extreme decimal scales", () => {
  assert.equal(
    formatSupply("18446744073709551615", 6),
    "18446744073709.551615",
  );
  assert.equal(formatSupply("1000000", 6), "1");
  assert.equal(formatSupply("0", 9), "0");
  assert.equal(formatSupply("1", 255), `0.${"0".repeat(254)}1`);
});

test("legacy decoding keeps null authority semantics and exact supply", () => {
  const inspection = decodeMintAccount(mintAccount(), metadata);
  assert.equal(inspection.source, "rpc");
  assert.equal(inspection.slot, 321);
  assert.equal(inspection.mintAuthority, null);
  assert.equal(inspection.program.name, "Token Program");
  assert.equal(inspection.supply.raw, "18446744073709551615");
  assert.equal(inspection.supply.formatted, "18446744073709.551615");
  assert.equal(JSON.stringify(inspection).includes("revoked"), false);
});

test("Token-2022 decoding preserves unknown extension state and explains limited coverage", () => {
  const account = mintAccount();
  account.owner = TOKEN_2022;
  account.data.program = "spl-token-2022";
  account.data.parsed.info.mintAuthority = MINT;
  account.data.parsed.info.extensions = [
    { extension: "permanentDelegate", state: { delegate: MINT } },
    { extension: "futureExtension", state: { arbitrary: "<script>" } },
    { extension: "nonTransferable" },
  ];
  const inspection = decodeMintAccount(account, metadata);
  assert.equal(inspection.program.name, "Token-2022");
  assert.equal(inspection.extensions[0]?.type, "permanentDelegate");
  assert.deepEqual(inspection.extensions[1]?.state, { arbitrary: "<script>" });
  assert.equal(inspection.extensions[2]?.state, null);
  assert.match(inspection.notes.join(" "), /beyond mint and freeze/i);
});

test("both native mints get a special supply explanation", () => {
  for (const address of [
    "So11111111111111111111111111111111111111112",
    "9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP",
  ]) {
    const account = mintAccount();
    if (address.startsWith("9pan")) {
      account.owner = TOKEN_2022;
      account.data.program = "spl-token-2022";
    }
    const inspection = decodeMintAccount(account, { ...metadata, address });
    assert.match(inspection.notes.join(" "), /not.*circulating supply/i);
  }
});

test("missing authority is malformed instead of being interpreted as null", () => {
  const account = mintAccount();
  Reflect.deleteProperty(account.data.parsed.info, "mintAuthority");
  throwsCode(
    () => decodeMintAccount(account, metadata),
    "RPC_INVALID_RESPONSE",
  );
});

test("invalid account states and fields produce specific errors", () => {
  throwsCode(() => decodeMintAccount(null, metadata), "ACCOUNT_NOT_FOUND");
  const unsupported = mintAccount();
  unsupported.owner = "11111111111111111111111111111111";
  throwsCode(
    () => decodeMintAccount(unsupported, metadata),
    "UNSUPPORTED_PROGRAM",
  );
  const tokenAccount = mintAccount();
  tokenAccount.data.parsed.type = "account";
  throwsCode(() => decodeMintAccount(tokenAccount, metadata), "NOT_A_MINT");
  const uninitialized = mintAccount();
  uninitialized.data.parsed.info.isInitialized = false;
  throwsCode(
    () => decodeMintAccount(uninitialized, metadata),
    "UNINITIALIZED_MINT",
  );
  throwsCode(
    () =>
      decodeMintAccount(
        { ...mintAccount(), data: ["AAAA", "base64"] },
        metadata,
      ),
    "PARSING_UNAVAILABLE",
  );
  for (const mutation of [
    { supply: "18446744073709551616" },
    { supply: "-1" },
    { supply: "01" },
    { supply: "not-an-integer" },
    { supply: 5 },
    { decimals: 256 },
    { decimals: -1 },
    { freezeAuthority: "invalid" },
    { extensions: [{ extension: 42 }] },
  ]) {
    const account = mintAccount();
    Object.assign(account.data.parsed.info, mutation);
    throwsCode(
      () => decodeMintAccount(account, metadata),
      "RPC_INVALID_RESPONSE",
    );
  }
});
