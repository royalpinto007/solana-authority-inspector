import type { ApiError, Example, Inspection, Network } from "../types.js";

function find<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing interface element: ${selector}`);
  return element;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name: string): SVGSVGElement {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.classList.add("icon");
  node.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `/icons.svg#${name}`);
  node.append(use);
  return node;
}

const form = find<HTMLFormElement>("#inspect-form");
const addressInput = find<HTMLInputElement>("#mint-address");
const networkInput = find<HTMLSelectElement>("#network");
const inspectButton = find<HTMLButtonElement>("#inspect-button");
const cancelButton = find<HTMLButtonElement>("#cancel-button");
const message = find<HTMLParagraphElement>("#message");
const inspection = find<HTMLElement>("#inspection");
const exampleList = find<HTMLElement>("#examples");
const toast = find<HTMLElement>("#toast");
const initialEmpty = inspection.cloneNode(true) as HTMLElement;
const recentKey = "authority-inspector:recent";
const liveMints: Record<string, string> = {
  usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  wsol: "So11111111111111111111111111111111111111112",
  pyusd: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
};

let activeRequest: AbortController | undefined;
let requestNumber = 0;
let lastResult: Inspection | undefined;
let toastTimer: number | undefined;
let recentAddresses: string[] = [];

function networkName(network: Network): string {
  return network === "devnet" ? "Devnet" : "Mainnet";
}

function currentNetwork(): Network {
  return networkInput.value === "devnet" ? "devnet" : "mainnet-beta";
}

function showMessage(text: string, error = false): void {
  message.textContent = text;
  message.classList.toggle("error", error);
}

function notify(text: string): void {
  window.clearTimeout(toastTimer);
  toast.textContent = text;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function setBusy(busy: boolean): void {
  inspectButton.disabled = busy;
  inspectButton.replaceChildren(
    document.createTextNode(busy ? "Reading mint…" : "Inspect mint"),
    icon("search"),
  );
  cancelButton.hidden = !busy;
  inspection.setAttribute("aria-busy", String(busy));
}

function resetPanel(className: string): void {
  inspection.replaceChildren();
  inspection.className = `inspection ${className}`;
}

function renderEmpty(): void {
  inspection.className = initialEmpty.className;
  inspection.replaceChildren(
    ...Array.from(initialEmpty.cloneNode(true).childNodes),
  );
}

function renderLoading(example: boolean): void {
  resetPanel("loading-state");
  const title = element("div", "loading-title");
  title.append(
    element("span", "loading-dot"),
    document.createTextNode(
      example ? "Opening example snapshot" : "Reading the mint account",
    ),
  );
  const skeletons = element("div", "skeleton-row");
  skeletons.setAttribute("aria-hidden", "true");
  skeletons.append(
    element("div", "skeleton skeleton-card"),
    element("div", "skeleton skeleton-card"),
  );
  inspection.append(
    title,
    element(
      "p",
      "",
      example
        ? "Synthetic data for exploring authorities."
        : `Requesting confirmed data from ${networkName(currentNetwork())}.`,
    ),
    element("div", "skeleton skeleton-line"),
    skeletons,
  );
}

function copyButton(value: string, name: string): HTMLButtonElement {
  const button = element("button", "icon-button");
  button.type = "button";
  button.setAttribute("aria-label", `Copy ${name}`);
  button.title = `Copy ${name}`;
  button.append(icon("copy"));
  button.addEventListener("click", () => {
    void navigator.clipboard.writeText(value).then(
      () => {
        button.replaceChildren(icon("check"));
        notify(`${name.charAt(0).toUpperCase() + name.slice(1)} copied`);
        window.setTimeout(() => button.replaceChildren(icon("copy")), 1800);
      },
      () => notify("Copy unavailable. Select the address to copy it."),
    );
  });
  return button;
}

function addressRow(value: string, name: string): HTMLElement {
  const row = element("div", "address-row");
  row.append(element("code", "address-text", value), copyButton(value, name));
  return row;
}

function authorityRole(
  kind: "mint" | "freeze",
  authority: string | null,
): HTMLElement {
  const role = element("article", "authority-role");
  role.dataset.authority = kind;
  const title = element("div", "authority-title");
  const symbol = element("span", `authority-symbol ${kind}`);
  symbol.append(icon(kind === "mint" ? "key" : "snowflake"));
  title.append(
    symbol,
    element("h3", "", kind === "mint" ? "Mint authority" : "Freeze authority"),
    element(
      "span",
      `authority-status${authority === null ? " unset" : ""}`,
      authority === null ? "Not set" : "Set",
    ),
  );
  const description =
    authority === null
      ? kind === "mint"
        ? "No mint authority is set on this mint account."
        : "No freeze authority is set on this mint account."
      : kind === "mint"
        ? "This address can authorize new token issuance."
        : "This address can authorize freezing or thawing token accounts.";
  role.append(title);
  if (authority) role.append(addressRow(authority, `${kind} authority`));
  else role.append(element("p", "not-set", "No address assigned"));
  role.append(element("p", "authority-description", description));
  return role;
}

function fact(
  label: string,
  value: string,
  note?: string,
  mono = false,
): HTMLElement {
  const node = element("div", "fact");
  node.append(
    element("p", "fact-label", label),
    element("p", `fact-value${mono ? " mono" : ""}`, value),
  );
  if (note) node.append(element("p", "fact-note", note));
  return node;
}

function disclosure(
  title: string,
  count?: string,
): { node: HTMLDetailsElement; body: HTMLElement } {
  const node = element("details", "disclosure");
  const summary = element("summary");
  const label = element("span", "", title);
  if (count) label.append(element("span", "detail-count", count));
  summary.append(label, icon("chevron"));
  const body = element("div", "details-body");
  node.append(summary, body);
  return { node, body };
}

function exportResult(result: Inspection): void {
  const blob = new Blob([`${JSON.stringify(result, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = element("a");
  link.href = url;
  const prefix = result.source === "example" ? "example" : result.network;
  link.download = `authority-inspection-${prefix}-${result.address.slice(0, 8)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify("JSON snapshot exported");
}

function renderInspection(result: Inspection): void {
  resetPanel("result-state");
  const header = element("div", "result-heading");
  const heading = element("div");
  heading.append(element("h2", "", "Mint configuration"));
  const labels = element("div", "result-labels");
  labels.append(
    element(
      "span",
      `badge ${result.source === "rpc" ? "live" : "example"}`,
      result.source === "rpc" ? "Live RPC snapshot" : "Example snapshot",
    ),
    element("span", "badge", networkName(result.network)),
    element("span", "badge program", result.program.name),
  );
  heading.append(labels);
  const exportButton = element("button", "button secondary", "Export JSON");
  exportButton.id = "export-button";
  exportButton.type = "button";
  exportButton.title = "Export JSON";
  exportButton.setAttribute("aria-label", "Export JSON");
  exportButton.prepend(icon("download"));
  exportButton.addEventListener("click", () => exportResult(result));
  header.append(heading, exportButton);
  const identity = element("div", "mint-identity");
  identity.append(
    element(
      "p",
      "small-label",
      result.source === "example"
        ? `${result.exampleName ?? "Synthetic mint"} · synthetic address`
        : "Mint account",
    ),
    addressRow(result.address, "mint address"),
  );
  const flow = element("div", "authority-flow");
  const origin = element("div", "flow-origin", "Token mint");
  origin.prepend(icon("mint"));
  const branches = element("div", "branch-lines");
  branches.setAttribute("aria-hidden", "true");
  const roles = element("div", "authority-roles");
  roles.append(
    authorityRole("mint", result.mintAuthority),
    authorityRole("freeze", result.freezeAuthority),
  );
  flow.append(
    origin,
    branches,
    roles,
    element(
      "p",
      "authority-footnote",
      "An authority address may be a wallet, multisig or program-derived address. Its owner is not identified here.",
    ),
  );
  const facts = element("div", "facts");
  facts.append(
    fact(
      "Token program",
      result.program.name,
      result.program.name === "Token-2022"
        ? "Extensions may add other controls"
        : undefined,
    ),
    fact(
      "Token supply",
      result.supply.formatted,
      result.notes.some((note) => note.includes("native wrapped SOL"))
        ? "Native mint field; not circulating supply"
        : "Exact value adjusted for decimals",
      true,
    ),
    fact("Decimals", String(result.supply.decimals), undefined, true),
  );
  const details = element("div", "result-details");
  const configuration = disclosure("Account details");
  configuration.body.append(
    element("p", "", "Program owner"),
    addressRow(result.program.id, "token program address"),
    element(
      "p",
      "program-id",
      `Initialized: ${result.initialized ? "yes" : "no"}. Raw supply: ${result.supply.raw}.`,
    ),
  );
  details.append(configuration.node);
  if (result.program.name === "Token-2022" || result.extensions.length > 0) {
    const extensions = disclosure(
      "Token-2022 extensions",
      `${result.extensions.length} parsed`,
    );
    extensions.node.dataset.testid = "extensions";
    extensions.body.append(
      element(
        "p",
        "extension-caveat",
        "Mint and freeze authorities are only part of Token-2022. Other controls may appear in extensions. Parsed state below is not a complete authority audit; null fields and unknown extensions are preserved.",
      ),
    );
    const list = element("div", "extension-list");
    for (const extension of result.extensions) {
      const item = element("details", "extension-item");
      item.append(
        element("summary", "", extension.type),
        element(
          "pre",
          "json-block",
          JSON.stringify(extension.state, null, 2) ?? "null",
        ),
      );
      list.append(item);
    }
    if (result.extensions.length === 0)
      list.append(element("p", "", "No parsed extensions were returned."));
    extensions.body.append(list);
    details.append(extensions.node);
  }
  if (result.notes.length > 0) {
    const notes = disclosure(
      "Reading this snapshot",
      `${result.notes.length} notes`,
    );
    const list = element("ul");
    for (const note of result.notes) list.append(element("li", "", note));
    notes.body.append(list);
    details.append(notes.node);
  }
  const raw = disclosure("Raw parsed account", "JSON");
  raw.body.append(
    element(
      "pre",
      "json-block",
      JSON.stringify(result.account, null, 2) ?? "null",
    ),
  );
  details.append(raw.node);
  const meta = element("div", "snapshot-meta");
  if (result.source === "rpc") {
    meta.append(
      element(
        "span",
        "",
        `Slot ${result.slot?.toLocaleString("en-US") ?? "unavailable"}`,
      ),
      element("span", "", `Commitment: ${result.commitment}`),
    );
    if (result.observedAt) {
      const time = element(
        "time",
        "",
        `Read ${new Date(result.observedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })}`,
      );
      time.dateTime = result.observedAt;
      time.title = result.observedAt;
      meta.append(time);
    }
  } else {
    meta.append(
      element(
        "span",
        "example-notice",
        "Synthetic example. No chain read, slot or observation time.",
      ),
    );
  }
  inspection.append(header, identity, flow, facts, details, meta);
}

class LookupError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

function renderError(error: LookupError, example: boolean): void {
  resetPanel("error-state");
  const symbol = element("div", "error-symbol");
  symbol.append(icon("info"));
  const retry = element(
    "button",
    "button secondary",
    example ? "Choose another example" : "Try again",
  );
  retry.type = "button";
  retry.addEventListener("click", () => {
    if (example) find<HTMLButtonElement>("[data-example]").focus();
    else void inspectLive();
  });
  inspection.append(
    symbol,
    element("h2", "", "Couldn't inspect this mint"),
    element("p", "", error.message),
    element("div", "error-code", error.code),
    retry,
  );
}

async function requestInspection(
  path: string,
  body?: { address: string; network: Network },
): Promise<void> {
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const thisRequest = ++requestNumber;
  const example = body === undefined;
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20000);
  setBusy(true);
  showMessage("");
  renderLoading(example);
  try {
    const response = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const payload = (await response.json()) as Inspection | ApiError;
    if (thisRequest !== requestNumber) return;
    if (!response.ok) {
      const error = (payload as ApiError).error;
      throw new LookupError(
        error?.message ?? "The lookup failed. Try again.",
        error?.code ?? "REQUEST_FAILED",
      );
    }
    const result = payload as Inspection;
    lastResult = result;
    renderInspection(result);
    if (result.source === "rpc") rememberAddress(result.address);
    showMessage(
      result.source === "example"
        ? "Example loaded. These values are synthetic, not live chain data."
        : `Mint read from ${networkName(result.network)} at confirmed commitment.`,
    );
    inspection.focus({ preventScroll: true });
  } catch (error) {
    if (thisRequest !== requestNumber) return;
    if (controller.signal.aborted && !timedOut) return;
    const failure = timedOut
      ? new LookupError(
          "The lookup took too long. Try again in a moment.",
          "TIMEOUT",
        )
      : error instanceof LookupError
        ? error
        : new LookupError(
            "Couldn't reach the inspector. Check that the local server is running, then try again.",
            "CONNECTION_FAILED",
          );
    renderError(failure, example);
    showMessage(failure.message, true);
  } finally {
    window.clearTimeout(timer);
    if (thisRequest === requestNumber) {
      activeRequest = undefined;
      setBusy(false);
    }
  }
}

async function inspectLive(): Promise<void> {
  const address = addressInput.value.trim();
  addressInput.value = address;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    addressInput.setAttribute("aria-invalid", "true");
    showMessage(
      "Enter a Solana address with 32–44 base58 characters. Use a token mint, not a wallet.",
      true,
    );
    addressInput.focus();
    return;
  }
  addressInput.removeAttribute("aria-invalid");
  await requestInspection("/api/inspect", {
    address,
    network: currentNetwork(),
  });
}

function stopRequest(): void {
  ++requestNumber;
  activeRequest?.abort();
  activeRequest = undefined;
  setBusy(false);
  if (lastResult) renderInspection(lastResult);
  else renderEmpty();
}

function renderRecent(): void {
  const container = find<HTMLElement>("#recent");
  const list = find<HTMLElement>("#recent-list");
  list.replaceChildren();
  container.hidden = recentAddresses.length === 0;
  for (const address of recentAddresses) {
    const button = element(
      "button",
      "recent-mint",
      `${address.slice(0, 4)}…${address.slice(-4)}`,
    );
    button.type = "button";
    button.title = address;
    button.setAttribute(
      "aria-label",
      `Inspect recent mint ${address.slice(0, 4)}…${address.slice(-4)}: ${address}`,
    );
    button.addEventListener("click", () => {
      addressInput.value = address;
      void inspectLive();
    });
    list.append(button);
  }
}

function rememberAddress(address: string): void {
  recentAddresses = [
    address,
    ...recentAddresses.filter((value) => value !== address),
  ].slice(0, 8);
  try {
    localStorage.setItem(recentKey, JSON.stringify(recentAddresses));
  } catch {
    /* Private browsing may disable storage. */
  }
  renderRecent();
}

async function loadExamples(): Promise<void> {
  try {
    const response = await fetch("/api/examples");
    if (!response.ok) throw new Error("Examples unavailable");
    const examples = (await response.json()) as Example[];
    exampleList.replaceChildren();
    for (const example of examples) {
      const button = element("button", "example-button");
      button.type = "button";
      button.dataset.example = example.id;
      button.title = example.description;
      button.append(
        element("strong", "", example.name),
        element("span", "", "Offline example"),
      );
      button.addEventListener(
        "click",
        () =>
          void requestInspection(
            `/api/examples/${encodeURIComponent(example.id)}`,
          ),
      );
      exampleList.append(button);
    }
  } catch {
    exampleList.replaceChildren(
      element("span", "examples-loading", "Examples unavailable."),
    );
    const retry = element("button", "text-button", "Retry");
    retry.type = "button";
    retry.addEventListener("click", () => void loadExamples());
    exampleList.append(retry);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void inspectLive();
});
addressInput.addEventListener("input", () => {
  addressInput.removeAttribute("aria-invalid");
  if (message.classList.contains("error")) showMessage("");
});
networkInput.addEventListener("change", () => {
  stopRequest();
  showMessage(
    `Ready to inspect on ${networkName(currentNetwork())}.${lastResult ? ` The snapshot below is from ${lastResult.source === "example" ? "an offline example" : networkName(lastResult.network)}.` : ""}`,
  );
});
cancelButton.addEventListener("click", () => {
  stopRequest();
  showMessage("Lookup cancelled.");
});
document
  .querySelectorAll<HTMLButtonElement>("[data-mint]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      const address = liveMints[button.dataset.mint ?? ""];
      if (!address) return;
      addressInput.value = address;
      networkInput.value = "mainnet-beta";
      void inspectLive();
    });
  });
find<HTMLButtonElement>("#clear-history").addEventListener("click", () => {
  recentAddresses = [];
  try {
    localStorage.removeItem(recentKey);
  } catch {
    /* Storage is optional. */
  }
  renderRecent();
  notify("Recent addresses cleared");
});

try {
  const stored: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
  if (Array.isArray(stored))
    recentAddresses = stored
      .filter(
        (value): value is string =>
          typeof value === "string" &&
          /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
      )
      .slice(0, 8);
} catch {
  /* Corrupt or unavailable storage does not block lookups. */
}
renderRecent();
void loadExamples();
