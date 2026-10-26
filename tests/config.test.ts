import assert from "node:assert/strict";
import test from "node:test";
import { parsePort } from "../src/config.js";

test("server accepts only complete TCP port numbers", () => {
  assert.equal(parsePort(undefined), 4410);
  assert.equal(parsePort("4521"), 4521);
  for (const value of [
    "",
    "0",
    "65536",
    "1.5",
    "4410oops",
    " 4410",
    "-1",
    "Infinity",
  ])
    assert.throws(() => parsePort(value), /PORT/);
});
