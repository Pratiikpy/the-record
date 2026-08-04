/**
 * Cross-register navigation.
 *
 * Defined once because it was wrong three times: each renderer hand-wrote its
 * own nav, and every page ended up linking at least one sibling to "#". Links
 * that go nowhere are the cheapest possible way to make a set of registers look
 * like three unfinished demos rather than one system.
 *
 * Paths are relative to a register's own `out/index.html`.
 */
export type RegisterName = "covenant" | "procedure" | "reprod" | "index";

interface Entry {
  label: string;
  /** path from one register's out/ directory to another's */
  from: Record<Exclude<RegisterName, "index">, string>;
  /** path from `site/index.html`, where the landing page is written */
  fromIndex: string;
}

const ENTRIES: Record<Exclude<RegisterName, "index">, Entry> = {
  covenant: {
    label: "Covenant",
    from: {
      covenant: "index.html",
      procedure: "../../covenant/out/index.html",
      reprod: "../../covenant/out/index.html",
    },
    fromIndex: "../packages/covenant/out/index.html",
  },
  procedure: {
    label: "Procedure",
    from: {
      covenant: "../../procedure/out/index.html",
      procedure: "index.html",
      reprod: "../../procedure/out/index.html",
    },
    fromIndex: "../packages/procedure/out/index.html",
  },
  reprod: {
    label: "Reprod",
    from: {
      covenant: "../../reprod/out/index.html",
      procedure: "../../reprod/out/index.html",
      reprod: "index.html",
    },
    fromIndex: "../packages/reprod/out/index.html",
  },
};

export const REGISTERS = Object.keys(ENTRIES) as Array<Exclude<RegisterName, "index">>;

/** Nav for a register page: every sibling reachable, self marked current. */
export function navFor(
  current: Exclude<RegisterName, "index">,
): ReadonlyArray<{ label: string; href: string; current?: boolean }> {
  return REGISTERS.map((name) => ({
    label: ENTRIES[name].label,
    href: ENTRIES[name].from[current],
    ...(name === current ? { current: true } : {}),
  }));
}

export function hrefFromIndex(name: Exclude<RegisterName, "index">): string {
  return ENTRIES[name].fromIndex;
}

export function labelOf(name: Exclude<RegisterName, "index">): string {
  return ENTRIES[name].label;
}
