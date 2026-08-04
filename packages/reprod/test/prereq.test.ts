import { describe, it, expect } from "vitest";
import { teeNodeRefFromGoMod } from "../src/rebuild.js";

/**
 * Every fce-extension-scaffold language image begins
 * `FROM local/tee-node-base:${TEE_NODE_REF}` — an image the repo builds
 * separately via scripts/build-node-base.sh. A verifier running a plain
 * `docker build` on the language Dockerfile fails outright with
 * `InvalidDefaultArgInFrom`, which is exactly what the first corpus run hit.
 *
 * The ref is not a constant: it is the commit embedded in the tee-node
 * pseudo-version pinned in go/go.mod. Hardcoding it would silently contradict
 * a dependency bump, so it is derived — and that derivation is asserted here.
 */
describe("teeNodeRefFromGoMod", () => {
  const REAL_GO_MOD = `
module extension-scaffold/go

go 1.24

require (
	github.com/ethereum/go-ethereum v1.14.0
	github.com/flare-foundation/tee-node v0.0.21-0.20260619120252-31fc839ae6d2
)
`;

  it("extracts the commit from a Go pseudo-version", () => {
    expect(teeNodeRefFromGoMod(REAL_GO_MOD)).toBe("31fc839ae6d2");
  });

  it("the derived ref is the real tee-node v0.0.21 commit", () => {
    // tag v0.0.21 = 31fc839ae6d22e3ff403573a832e6eddcb300fc2
    const ref = teeNodeRefFromGoMod(REAL_GO_MOD)!;
    expect("31fc839ae6d22e3ff403573a832e6eddcb300fc2".startsWith(ref)).toBe(true);
  });

  it("returns a plain tag unchanged when the pin is not a pseudo-version", () => {
    expect(
      teeNodeRefFromGoMod("require github.com/flare-foundation/tee-node v0.0.24"),
    ).toBe("v0.0.24");
  });

  it("follows a bumped pin rather than contradicting it", () => {
    const bumped = REAL_GO_MOD.replace("31fc839ae6d2", "aabbccddeeff");
    expect(teeNodeRefFromGoMod(bumped)).toBe("aabbccddeeff");
  });

  it("returns null when tee-node is not pinned at all", () => {
    expect(teeNodeRefFromGoMod("module x\n\ngo 1.24\n")).toBeNull();
    expect(teeNodeRefFromGoMod("")).toBeNull();
  });

  it("is not fooled by a similarly named module", () => {
    // Must match the flare-foundation path specifically.
    expect(teeNodeRefFromGoMod("require github.com/someone/tee-node v9.9.9")).toBeNull();
  });
});
