import { z } from "zod";
import type { Inspection, Network } from "../types.js";
import { InspectorError } from "../domain/errors.js";
import { decodeMintAccount } from "../domain/mint.js";

const ENDPOINTS: Record<Network, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
};
const MAX_RESPONSE_BYTES = 256 * 1024;
const envelope = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.literal(1),
  result: z.object({
    context: z.object({
      slot: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    }),
    value: z.unknown(),
  }),
});

interface RpcOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  let seconds: number;
  if (/^[0-9]+$/.test(value)) seconds = Number(value);
  else if (/^[A-Z][a-z]{2}, /.test(value)) {
    seconds = Math.ceil((Date.parse(value) - Date.now()) / 1000);
  } else return undefined;
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.max(1, Math.min(3600, seconds));
}

async function readResponse(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new InspectorError(
      "RESPONSE_TOO_LARGE",
      "The RPC response exceeded the local size limit.",
    );
  }
  if (!response.body) {
    throw new InspectorError(
      "RPC_INVALID_RESPONSE",
      "The RPC returned an empty response.",
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new InspectorError(
          "RESPONSE_TOO_LARGE",
          "The RPC response exceeded the local size limit.",
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks).toString("utf8"),
      (_key: string, value: unknown, context?: { source?: string }) => {
        if (
          typeof value === "number" &&
          !Number.isSafeInteger(value) &&
          context?.source &&
          /^-?[0-9]+$/.test(context.source)
        ) {
          return context.source;
        }
        return value;
      },
    ) as unknown;
  } catch {
    throw new InspectorError(
      "RPC_INVALID_RESPONSE",
      "The RPC returned unreadable JSON. Try again.",
    );
  }
}

export async function inspectMint(
  address: string,
  network: Network,
  options: RpcOptions = {},
): Promise<Inspection> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10_000,
  );
  try {
    const response = await (options.fetchImpl ?? fetch)(ENDPOINTS[network], {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [address, { commitment: "confirmed", encoding: "jsonParsed" }],
      }),
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) {
        throw new InspectorError(
          "RPC_RATE_LIMITED",
          "The public RPC is rate limited. Wait a moment before trying again.",
          429,
          retryAfterSeconds(response.headers.get("retry-after")),
        );
      }
      if (response.status === 403) {
        throw new InspectorError(
          "RPC_BLOCKED",
          "The public RPC blocked this request. Try again later.",
          502,
        );
      }
      throw new InspectorError(
        "RPC_UNAVAILABLE",
        "The public RPC is unavailable. Try again shortly.",
        502,
      );
    }
    const payload = await readResponse(response);
    if (payload && typeof payload === "object" && "error" in payload) {
      throw new InspectorError(
        "RPC_UNAVAILABLE",
        "The public RPC could not complete this lookup. Try again shortly.",
      );
    }
    const result = envelope.safeParse(payload);
    if (!result.success || !Object.hasOwn(result.data.result, "value")) {
      throw new InspectorError(
        "RPC_INVALID_RESPONSE",
        "The RPC returned an unexpected response. Try again.",
      );
    }
    return decodeMintAccount(result.data.result.value, {
      address,
      network,
      source: "rpc",
      slot: result.data.result.context.slot,
      observedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new InspectorError(
        "RPC_TIMEOUT",
        "The RPC did not respond in time. Try again.",
        504,
      );
    }
    if (error instanceof InspectorError) throw error;
    throw new InspectorError(
      "RPC_UNAVAILABLE",
      "Could not reach the public RPC. Check your connection and try again.",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}
