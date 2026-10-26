import type { Example, Inspection } from "../types.js";
import {
  decodeMintAccount,
  TOKEN_PROGRAM,
  TOKEN_2022,
} from "../domain/mint.js";

export const examples: Example[] = [
  {
    id: "fixed-supply",
    name: "No mint or freeze authority",
    description: "Synthetic legacy mint with both authority roles unset.",
  },
  {
    id: "managed",
    name: "Managed mint",
    description: "Synthetic mint with active mint and freeze authorities.",
  },
  {
    id: "extensions",
    name: "Token-2022 extensions",
    description:
      "Synthetic mint with a permanent delegate and transfer fee configuration.",
  },
];

const EXAMPLE_ADDRESSES = {
  "fixed-supply": "11111111111111111111111111111112",
  managed: "11111111111111111111111111111113",
  extensions: "11111111111111111111111111111114",
} as const;
const EXAMPLE_AUTHORITY = "11111111111111111111111111111115";

export function getExample(id: string): Inspection | undefined {
  const example = examples.find((item) => item.id === id);
  if (!example) return undefined;
  const extended = example.id === "extensions";
  const managed = example.id !== "fixed-supply";
  const owner = extended ? TOKEN_2022 : TOKEN_PROGRAM;
  const account = {
    owner,
    executable: false,
    data: {
      program: extended ? "spl-token-2022" : "spl-token",
      parsed: {
        type: "mint",
        info: {
          mintAuthority: managed ? EXAMPLE_AUTHORITY : null,
          freezeAuthority: managed ? EXAMPLE_AUTHORITY : null,
          decimals: 6,
          supply: "1000000000000",
          isInitialized: true,
          extensions: extended
            ? [
                {
                  extension: "permanentDelegate",
                  state: { delegate: EXAMPLE_AUTHORITY },
                },
                {
                  extension: "transferFeeConfig",
                  state: {
                    transferFeeConfigAuthority: EXAMPLE_AUTHORITY,
                    withdrawWithheldAuthority: EXAMPLE_AUTHORITY,
                    withheldAmount: 0,
                    olderTransferFee: {
                      epoch: 0,
                      maximumFee: 1000000,
                      transferFeeBasisPoints: 25,
                    },
                    newerTransferFee: {
                      epoch: 0,
                      maximumFee: 1000000,
                      transferFeeBasisPoints: 25,
                    },
                  },
                },
              ]
            : [],
        },
      },
    },
  };
  return decodeMintAccount(account, {
    source: "example",
    exampleName: example.name,
    address: EXAMPLE_ADDRESSES[example.id],
    network: "mainnet-beta",
    slot: null,
    observedAt: null,
  });
}
