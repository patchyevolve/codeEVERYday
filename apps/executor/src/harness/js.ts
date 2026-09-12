/**
 * JavaScript harness — user writes a module that exports the entry function
 * (module.exports = fn or exports.fn = fn). Cases are embedded as JSON.
 * Arrays are compared deeply; numbers strictly; strings byte-exact.
 */

import type { Harness, TestCase } from "@cpd/core";

export function generateJsHarness(code: string, h: Harness, testCases: TestCase[]): { main: string; compileCmd: string; runCmd: string } {
  const userModule = `${code}

const userFn = typeof module.exports === "function" ? module.exports : module.exports[${JSON.stringify(h.entryFn)}];
if (typeof userFn !== "function") {
  console.error("entry function " + ${JSON.stringify(h.entryFn)} + " not exported");
  process.exit(1);
}
`;

  const cases = JSON.stringify(
    testCases.map((tc, i) => ({
      input: (tc.input as unknown[]) ?? [],
      expected: tc.expected,
      desc: tc.description ?? `case ${i + 1}`
    }))
  );

  const main = `${userModule}

const cases = ${cases};

function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEq(x, b[i]));
  }
  return false;
}

const cmpFloat = ${JSON.stringify(h.comparator === "float" || h.comparator === "array_float")};

for (const c of cases) {
  try {
    const r = userFn(...c.input);
    const actual = JSON.stringify(r);
    const ok = cmpFloat ? deepEq(r, c.expected) : JSON.stringify(r) === JSON.stringify(c.expected);
    if (ok) console.log("P|" + c.desc + "|" + JSON.stringify(c.expected) + "|" + actual);
    else console.log("F|" + c.desc + "|" + JSON.stringify(c.expected) + "|" + actual);
  } catch (e) {
    console.log("E|" + c.desc + "|" + (e instanceof Error ? e.message : String(e)));
  }
}
`;

  return {
    main,
    compileCmd: "node --check runner.js",
    runCmd: "node runner.js"
  };
}