export type Network = "mainnet-beta" | "devnet";

export interface Inspection {
  version: 1;
  source: "rpc" | "example";
  exampleName?: string;
  address: string;
  network: Network;
  slot: number | null;
  observedAt: string | null;
  commitment: "confirmed";
  program: { id: string; name: "Token Program" | "Token-2022" };
  mintAuthority: string | null;
  freezeAuthority: string | null;
  supply: { raw: string; formatted: string; decimals: number };
  initialized: boolean;
  extensions: { type: string; state: unknown }[];
  notes: string[];
  account: unknown;
}

export interface ApiError {
  error: { code: string; message: string };
}

export interface Example {
  id: "fixed-supply" | "managed" | "extensions";
  name: string;
  description: string;
}
