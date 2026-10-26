import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { fixtureRpc, MINT, rpcResult } from "./helpers/rpc.js";

test("API returns decoded live inspections and security headers through real HTTP transport", async (t) => {
  const fixture = await fixtureRpc((response) =>
    response.end(JSON.stringify(rpcResult())),
  );
  t.after(fixture.close);
  const response = await request(createApp({ fetchImpl: fixture.fetchImpl }))
    .post("/api/inspect")
    .send({ address: MINT, network: "mainnet-beta" })
    .expect(200);
  assert.equal(response.body.supply.formatted, "18446744073709.551615");
  assert.equal(response.body.source, "rpc");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.match(
    String(response.headers["content-security-policy"]),
    /default-src 'self'/,
  );
  assert.equal(fixture.requests.length, 1);
});

test("API rejects unknown keys, invalid addresses, unsupported networks, malformed and oversized bodies", async () => {
  const app = createApp();
  for (const body of [
    { address: MINT, network: "mainnet-beta", rpcUrl: "http://localhost" },
    { address: "bad", network: "mainnet-beta" },
    { address: MINT, network: "testnet" },
    { address: MINT },
  ]) {
    const response = await request(app)
      .post("/api/inspect")
      .send(body)
      .expect(400);
    assert.equal(typeof response.body.error.code, "string");
  }
  await request(app)
    .post("/api/inspect")
    .type("text")
    .send("hello")
    .expect(415);
  await request(app).post("/api/inspect").type("json").send("{").expect(400);
  await request(app)
    .post("/api/inspect")
    .send({ address: "x".repeat(20_000), network: "devnet" })
    .expect(413);
});

test("local host and exact same-origin guards reject DNS rebinding and cross-site requests", async () => {
  const app = createApp();
  await request(app).get("/api/health").expect(200);
  await request(app).get("/api/health").set("Host", "evil.example").expect(403);
  await request(app)
    .post("/api/inspect")
    .set("Host", "localhost:4300")
    .set("Origin", "https://evil.example")
    .send({ address: MINT, network: "mainnet-beta" })
    .expect(403);
  await request(app)
    .get("/api/health")
    .set("Sec-Fetch-Site", "cross-site")
    .expect(403);
  await request(app)
    .get("/api/health")
    .set("Host", "localhost:4300")
    .set("Origin", "http://localhost:4300")
    .expect(200);
});

test("offline fixtures are clearly synthetic and pass through the mint decoder", async () => {
  const app = createApp({
    fetchImpl: () => Promise.reject(new Error("must not contact RPC")),
  });
  const examples = await request(app).get("/api/examples").expect(200);
  assert.equal(examples.body.length, 3);
  for (const example of examples.body) {
    const result = await request(app)
      .get(`/api/examples/${example.id}`)
      .expect(200);
    assert.equal(result.body.source, "example");
    assert.equal(result.body.slot, null);
    assert.equal(result.body.observedAt, null);
    assert.equal(typeof result.body.exampleName, "string");
    assert.equal(typeof result.body.supply.formatted, "string");
  }
  const missing = await request(app).get("/api/examples/missing").expect(404);
  assert.equal(missing.body.error.code, "NOT_FOUND");
});

test("API limits upstream concurrency and releases capacity after timeout", async (t) => {
  const fixture = await fixtureRpc(() => undefined);
  t.after(fixture.close);
  const app = createApp({ fetchImpl: fixture.fetchImpl, rpcTimeoutMs: 250 });
  const pending = [0, 1].map(() =>
    request(app)
      .post("/api/inspect")
      .send({ address: MINT, network: "devnet" })
      .then((response) => response),
  );
  while (fixture.requests.length < 2)
    await new Promise((resolve) => setTimeout(resolve, 5));
  const busy = await request(app)
    .post("/api/inspect")
    .send({ address: MINT, network: "devnet" })
    .expect(429);
  assert.equal(busy.body.error.code, "BUSY");
  const timedOut = await Promise.all(pending);
  assert.ok(timedOut.every((response) => response.status === 504));
  await request(app)
    .post("/api/inspect")
    .send({ address: MINT, network: "devnet" })
    .expect(504);
});

test("API rate limits repeated requests before contacting upstream", async () => {
  const app = createApp();
  for (let count = 0; count < 20; count++) {
    await request(app)
      .post("/api/inspect")
      .send({ address: "invalid", network: "devnet" })
      .expect(400);
  }
  const limited = await request(app)
    .post("/api/inspect")
    .send({ address: "invalid", network: "devnet" })
    .expect(429);
  assert.equal(limited.body.error.code, "RATE_LIMITED");
});

test("API treats malformed encodings and unsupported charsets as client errors", async () => {
  const app = createApp();
  await request(app)
    .post("/api/inspect")
    .set("Content-Type", "application/json; charset=iso-8859-1")
    .send("{}")
    .expect(415);
  await request(app)
    .post("/api/inspect")
    .set("Content-Type", "application/json")
    .set("Content-Encoding", "invalid")
    .send("{}")
    .expect(415);
  await request(app)
    .post("/api/inspect")
    .set("Content-Type", "application/json")
    .set("Content-Encoding", "gzip")
    .send("{}")
    .expect(400);
});

test("API distinguishes blocked public RPC responses", async (t) => {
  const fixture = await fixtureRpc((response) => {
    response.writeHead(403);
    response.end("upstream-private-message");
  });
  t.after(fixture.close);
  const response = await request(createApp({ fetchImpl: fixture.fetchImpl }))
    .post("/api/inspect")
    .send({ address: MINT, network: "devnet" })
    .expect(502);
  assert.equal(response.body.error.code, "RPC_BLOCKED");
  assert.equal(
    JSON.stringify(response.body).includes("upstream-private-message"),
    false,
  );
});

test("API returns bounded Retry-After for public RPC rate limits", async (t) => {
  for (const [value, expected] of [
    ["45", "45"],
    ["999999", "3600"],
    ["-10", undefined],
    ["invalid", undefined],
  ]) {
    await t.test(value ?? "missing", async (child) => {
      const fixture = await fixtureRpc((response) => {
        response.writeHead(429, { "Retry-After": value ?? "" });
        response.end("upstream-private-message");
      });
      child.after(fixture.close);
      const response = await request(
        createApp({ fetchImpl: fixture.fetchImpl }),
      )
        .post("/api/inspect")
        .send({ address: MINT, network: "devnet" })
        .expect(429);
      assert.equal(response.body.error.code, "RPC_RATE_LIMITED");
      assert.equal(response.headers["retry-after"], expected);
      assert.equal(
        JSON.stringify(response.body).includes("upstream-private-message"),
        false,
      );
    });
  }
});
