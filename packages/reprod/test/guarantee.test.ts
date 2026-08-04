import { describe, it, expect } from "vitest";
import { guaranteeFor, scopeOf, type Guarantee } from "../src/rebuild.js";

/**
 * The structural limit this module exists to state out loud:
 * **one machine cannot detect cross-machine nondeterminism.**
 *
 * Building twice on this host proves same-host determinism only. Flare's own
 * Python and TypeScript images will pass that check and still be unverifiable
 * by an auditor on different hardware. If the register let a same-host match
 * imply independent verifiability, it would be publishing a false assurance
 * about exactly the images that need it most.
 */

/** Transcribed verbatim from fce-extension-scaffold/REPRODUCIBILITY.md. */
const FLARE_TABLE = `
| Language | Guarantee | Why |
| --- | --- | --- |
| **Go** | **Bit-for-bit across machines** | Static CGO_ENABLED=0 binary. |
| **Python** | **Same-machine only** | pip .dist-info metadata varies. |
| **TypeScript** | **Same-machine only** | npm hoisting varies. |
`;

describe("guaranteeFor — parses the published table, does not hardcode", () => {
  it("reads Go as reproducible across machines", () => {
    expect(guaranteeFor(FLARE_TABLE, "Go")).toBe("CROSS_MACHINE");
  });

  it("reads Python and TypeScript as same-machine only", () => {
    expect(guaranteeFor(FLARE_TABLE, "Python")).toBe("SAME_MACHINE_ONLY");
    expect(guaranteeFor(FLARE_TABLE, "TypeScript")).toBe("SAME_MACHINE_ONLY");
  });

  it("returns UNDECLARED for a language the table does not mention", () => {
    expect(guaranteeFor(FLARE_TABLE, "Rust")).toBe("UNDECLARED");
  });

  it("returns UNDECLARED when there is no table at all", () => {
    expect(guaranteeFor("", "Go")).toBe("UNDECLARED");
    expect(guaranteeFor("# Readme\n\nno claims here", "Go")).toBe("UNDECLARED");
  });

  it("picks up an upstream fix instead of contradicting it", () => {
    // If Flare pins the Python base image by digest and updates the table, the
    // register must follow the source rather than a stale constant.
    const fixed = FLARE_TABLE.replace(
      "| **Python** | **Same-machine only** |",
      "| **Python** | **Bit-for-bit across machines** |",
    );
    expect(guaranteeFor(fixed, "Python")).toBe("CROSS_MACHINE");
  });

  it("is case-insensitive about the language name", () => {
    expect(guaranteeFor(FLARE_TABLE, "go")).toBe("CROSS_MACHINE");
  });
});

/**
 * tee-node makes its claim in prose and ships NO table. Reading only the table
 * form scored it UNDECLARED, understating a repo that explicitly promises
 * cross-machine reproducibility — caught by running the real corpus.
 */
const TEE_NODE_PROSE = `
# Reproducible Builds

This project produces reproducible Docker images. Given the same source code,
builds produce bit-for-bit identical image layers regardless of when or where
they are built.
`;

describe("guaranteeFor — prose claims, not just tables", () => {
  it("reads tee-node's prose promise as CROSS_MACHINE", () => {
    expect(guaranteeFor(TEE_NODE_PROSE, "Go")).toBe("CROSS_MACHINE");
  });

  it("prose applies whatever language is asked about, being repo-wide", () => {
    expect(guaranteeFor(TEE_NODE_PROSE, "Python")).toBe("CROSS_MACHINE");
  });

  it("a prose same-machine caveat still downgrades", () => {
    expect(
      guaranteeFor("Builds achieve same-machine determinism only on this host.", "Go"),
    ).toBe("SAME_MACHINE_ONLY");
  });

  it("the per-language table wins over repo-wide prose when both exist", () => {
    // The scaffold promises reproducibility generally but qualifies Python.
    const both = `${TEE_NODE_PROSE}\n${FLARE_TABLE}`;
    expect(guaranteeFor(both, "Python")).toBe("SAME_MACHINE_ONLY");
    expect(guaranteeFor(both, "Go")).toBe("CROSS_MACHINE");
  });

  it("a language missing from a table never inherits a neighbour's guarantee", () => {
    // The regression: falling through to prose handed an unlisted runtime
    // whichever claim happened to appear elsewhere in the document. Absence of
    // a row is absence of a claim — in BOTH directions.
    expect(guaranteeFor(FLARE_TABLE, "Rust")).toBe("UNDECLARED");
    expect(guaranteeFor(`${TEE_NODE_PROSE}\n${FLARE_TABLE}`, "Rust")).toBe("UNDECLARED");
  });

  it("does not mistake unrelated prose for a claim", () => {
    expect(guaranteeFor("This project builds a Docker image. See CI.", "Go")).toBe("UNDECLARED");
  });
});

describe("scopeOf — what a single verifier may claim", () => {
  it("only CROSS_MACHINE permits a claim of independent verifiability", () => {
    expect(scopeOf("CROSS_MACHINE").independentlyVerifiable).toBe(true);
    expect(scopeOf("SAME_MACHINE_ONLY").independentlyVerifiable).toBe(false);
    expect(scopeOf("UNDECLARED").independentlyVerifiable).toBe(false);
  });

  it("attaches a caveat wherever the claim is limited", () => {
    for (const g of ["SAME_MACHINE_ONLY", "UNDECLARED"] as Guarantee[]) {
      expect(scopeOf(g).caveat, `${g} must carry a caveat`).toBeTruthy();
    }
    expect(scopeOf("CROSS_MACHINE").caveat).toBeUndefined();
  });

  it("a same-host match on a SAME_MACHINE_ONLY image is never independently verifiable", () => {
    // The regression this whole file guards. A green double-build on Python
    // must NOT be presentable as third-party verification.
    const s = scopeOf("SAME_MACHINE_ONLY");
    expect(s.independentlyVerifiable).toBe(false);
    expect(s.caveat).toMatch(/other hardware|auditor/iu);
  });

  it("covers every guarantee value exhaustively", () => {
    const all: Guarantee[] = ["CROSS_MACHINE", "SAME_MACHINE_ONLY", "UNDECLARED"];
    for (const g of all) expect(scopeOf(g).guarantee).toBe(g);
  });
});
