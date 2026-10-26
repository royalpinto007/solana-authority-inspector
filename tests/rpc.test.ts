import assert from "node:assert/strict";
import test from "node:test";
import { inspectMint } from "../src/adapters/rpc.js";
import { InspectorError } from "../src/domain/errors.js";
import { fixtureRpc, MINT, rpcResult, TOKEN_2022 } from "./helpers/rpc.js";

test("RPC adapter sends confirmed jsonParsed to fixed cluster URLs and decodes a real HTTP response", async (t) => {
  const fixture = await fixtureRpc((response) =>
    response.end(JSON.stringify(rpcResult())),
  );
  t.after(fixture.close);
  const inspection = await inspectMint(MINT, "devnet", {
    fetchImpl: fixture.fetchImpl,
  });
  assert.equal(inspection.source, "rpc");
  assert.equal(inspection.slot, 321);
  assert.ok(
    inspection.observedAt && Number.isFinite(Date.parse(inspection.observedAt)),
  );
  assert.deepEqual(fixture.targets, ["https://api.devnet.solana.com"]);
  assert.deepEqual(fixture.requests[0]?.body, {
    jsonrpc: "2.0",
    id: 1,
    method: "getAccountInfo",
    params: [MINT, { commitment: "confirmed", encoding: "jsonParsed" }],
  });
});

test("RPC parsing preserves unsafe integer digits in extensions and exported account data", async (t) => {
  const body = `{
    "jsonrpc":"2.0","id":1,
    "result":{"context":{"slot":321},"value":{
      "owner":"${TOKEN_2022}","executable":false,
      "rentEpoch":18446744073709551615,"lamports":9007199254740991,
      "data":{"program":"spl-token-2022","parsed":{"type":"mint","info":{
        "mintAuthority":null,"freezeAuthority":null,"isInitialized":true,
        "supply":"18446744073709551615","decimals":6,
        "extensions":[{"extension":"transferFeeConfig","state":{
          "withheldAmount":18446744073709551614,
          "newerTransferFee":{"epoch":42,"maximumFee":18446744073709551615,"transferFeeBasisPoints":250}
        }}]
      }}}
    }}}
  `;
  const fixture = await fixtureRpc((response) => response.end(body));
  t.after(fixture.close);
  const inspection = await inspectMint(MINT, "mainnet-beta", {
    fetchImpl: fixture.fetchImpl,
  });
  assert.equal(inspection.supply.raw, "18446744073709551615");
  assert.deepEqual(inspection.extensions[0]?.state, {
    withheldAmount: "18446744073709551614",
    newerTransferFee: {
      epoch: 42,
      maximumFee: "18446744073709551615",
      transferFeeBasisPoints: 250,
    },
  });
  const account = inspection.account as Record<string, unknown>;
  assert.equal(account.rentEpoch, "18446744073709551615");
  assert.equal(account.lamports, 9007199254740991);
  const exported = JSON.parse(JSON.stringify(inspection));
  assert.equal(exported.account.rentEpoch, "18446744073709551615");
  assert.equal(
    exported.account.data.parsed.info.extensions[0].state.newerTransferFee
      .maximumFee,
    "18446744073709551615",
  );
  assert.equal(
    exported.account.data.parsed.info.extensions[0].state.withheldAmount,
    "18446744073709551614",
  );
  assert.equal(exported.account.lamports, 9007199254740991);
});

test("RPC adapter bounds delayed responses", async (t) => {
  const fixture = await fixtureRpc(() => undefined);
  t.after(fixture.close);
  await assert.rejects(
    inspectMint(MINT, "mainnet-beta", {
      fetchImpl: fixture.fetchImpl,
      timeoutMs: 40,
    }),
    (error: unknown) =>
      error instanceof InspectorError && error.code === "RPC_TIMEOUT",
  );
});

test("RPC adapter handles HTTP and JSON-RPC failures without leaking upstream text", async (t) => {
  for (const scenario of [
    { status: 429, body: "secret-upstream-detail", code: "RPC_RATE_LIMITED" },
    { status: 403, body: "secret-upstream-detail", code: "RPC_BLOCKED" },
    { status: 500, body: "secret-upstream-detail", code: "RPC_UNAVAILABLE" },
    { status: 302, body: "", code: "RPC_UNAVAILABLE" },
    { status: 200, body: "not-json", code: "RPC_INVALID_RESPONSE" },
    {
      status: 200,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "secret-upstream-detail" },
      }),
      code: "RPC_UNAVAILABLE",
    },
    {
      status: 200,
      body: JSON.stringify({ result: { value: null } }),
      code: "RPC_INVALID_RESPONSE",
    },
  ]) {
    await t.test(`${scenario.status} ${scenario.code}`, async (child) => {
      const fixture = await fixtureRpc((response) => {
        response.writeHead(scenario.status, {
          Location: "https://example.com",
        });
        response.end(scenario.body);
      });
      child.after(fixture.close);
      await assert.rejects(
        inspectMint(MINT, "mainnet-beta", { fetchImpl: fixture.fetchImpl }),
        (error: unknown) => {
          assert.ok(error instanceof InspectorError);
          assert.equal(error.code, scenario.code);
          assert.equal(error.message.includes("secret-upstream-detail"), false);
          return true;
        },
      );
      assert.equal(fixture.requests.length, 1);
    });
  }
});

test("RPC adapter enforces declared and streamed response size limits", async (t) => {
  for (const declared of [true, false]) {
    await t.test(declared ? "content-length" : "chunked", async (child) => {
      const fixture = await fixtureRpc((response) => {
        if (declared) response.setHeader("Content-Length", 300_000);
        response.write(" ".repeat(140_000));
        response.end(" ".repeat(140_000));
      });
      child.after(fixture.close);
      await assert.rejects(
        inspectMint(MINT, "mainnet-beta", { fetchImpl: fixture.fetchImpl }),
        (error: unknown) =>
          error instanceof InspectorError &&
          error.code === "RESPONSE_TOO_LARGE",
      );
    });
  }
});
