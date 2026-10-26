import path from "node:path";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { z } from "zod";
import type { ApiError } from "./types.js";
import { InspectorError } from "./domain/errors.js";
import { isPublicAddress } from "./domain/mint.js";
import { inspectMint } from "./adapters/rpc.js";
import { examples, getExample } from "./adapters/examples.js";

interface AppOptions {
  fetchImpl?: typeof fetch;
  rpcTimeoutMs?: number;
}

const inspectionRequest = z.strictObject({
  address: z.string().refine(isPublicAddress),
  network: z.enum(["mainnet-beta", "devnet"]),
});

function localHost(host: string | undefined): boolean {
  return (
    typeof host === "string" &&
    /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/.test(host)
  );
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      strictTransportSecurity: false,
    }),
  );
  app.use((request, response, next) => {
    const host = request.headers.host;
    const origin = request.headers.origin;
    const expectedOrigin = `http://${host}`;
    if (
      !localHost(host) ||
      (origin && origin !== expectedOrigin) ||
      request.headers["sec-fetch-site"] === "cross-site"
    ) {
      return next(
        new InspectorError(
          "FORBIDDEN",
          "Open the inspector through its local address.",
          403,
        ),
      );
    }
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (request, _response, next) => {
    if (request.method === "POST" && !request.is("application/json")) {
      return next(
        new InspectorError(
          "UNSUPPORTED_MEDIA_TYPE",
          "Send an application/json request body.",
          415,
        ),
      );
    }
    next();
  });
  app.use(express.json({ limit: "8kb", strict: true }));

  let attempts = 0;
  let windowStartedAt = Date.now();
  let inFlight = 0;
  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, mode: "read-only" });
  });
  app.get("/api/examples", (_request, response) => response.json(examples));
  app.get("/api/examples/:id", (request, response, next) => {
    const example = getExample(request.params.id);
    if (!example)
      return next(
        new InspectorError("NOT_FOUND", "This example does not exist.", 404),
      );
    response.json(example);
  });
  app.post("/api/inspect", async (request, response) => {
    const now = Date.now();
    if (now - windowStartedAt >= 60_000) {
      attempts = 0;
      windowStartedAt = now;
    }
    if (attempts >= 20) {
      response.setHeader(
        "Retry-After",
        String(Math.ceil((60_000 - (now - windowStartedAt)) / 1000)),
      );
      throw new InspectorError(
        "RATE_LIMITED",
        "The local lookup limit was reached. Wait a minute and try again.",
        429,
      );
    }
    attempts++;
    const parsed = inspectionRequest.safeParse(request.body);
    if (!parsed.success) {
      throw new InspectorError(
        "INVALID_REQUEST",
        "Enter a valid Solana mint address and choose Mainnet or Devnet.",
        400,
      );
    }
    if (inFlight >= 2) {
      response.setHeader("Retry-After", "1");
      throw new InspectorError(
        "BUSY",
        "Two lookups are already running. Wait for one to finish.",
        429,
      );
    }
    inFlight++;
    try {
      response.json(
        await inspectMint(parsed.data.address, parsed.data.network, {
          fetchImpl: options.fetchImpl,
          timeoutMs: options.rpcTimeoutMs,
        }),
      );
    } finally {
      inFlight--;
    }
  });
  app.use("/api", (_request, _response, next) =>
    next(
      new InspectorError("NOT_FOUND", "This API route does not exist.", 404),
    ),
  );
  app.use(express.static(path.join(import.meta.dirname, "public")));
  app.use((_request, _response, next) =>
    next(new InspectorError("NOT_FOUND", "This page does not exist.", 404)),
  );

  const errorHandler: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    _next,
  ) => {
    let safeError: InspectorError;
    if (error instanceof InspectorError) safeError = error;
    else if (
      error &&
      typeof error === "object" &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      safeError = new InspectorError(
        "REQUEST_TOO_LARGE",
        "The request body is too large.",
        413,
      );
    } else if (
      error &&
      typeof error === "object" &&
      "type" in error &&
      (error.type === "charset.unsupported" ||
        error.type === "encoding.unsupported")
    ) {
      safeError = new InspectorError(
        "UNSUPPORTED_MEDIA_TYPE",
        "Send UTF-8 JSON with a supported content encoding.",
        415,
      );
    } else if (
      error instanceof SyntaxError ||
      (error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 400)
    ) {
      safeError = new InspectorError(
        "INVALID_REQUEST",
        "Send a valid JSON request body.",
        400,
      );
    } else {
      safeError = new InspectorError(
        "INTERNAL_ERROR",
        "The lookup could not be completed. Try again.",
        500,
      );
    }
    const body: ApiError = {
      error: { code: safeError.code, message: safeError.message },
    };
    if (safeError.retryAfter !== undefined) {
      response.setHeader("Retry-After", String(safeError.retryAfter));
    }
    response.status(safeError.status).json(body);
  };
  app.use(errorHandler);
  return app;
}
