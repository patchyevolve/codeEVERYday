/**
 * Bash harness — user writes a bash FUNCTION (named by entryFn) that reads
 * its arguments and prints the answer to stdout. Strings are compared
 * byte-exact; numbers as text after numeric normalization.
 */

import type { Harness, TestCase } from "@cpd/core";

function shQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

function bashValue(v: unknown): string {
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(bashValue).join(" ");
  return String(v);
}

function normalize(v: unknown): string {
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v);
}

export function generateBashHarness(code: string, h: Harness, testCases: TestCase[]): { main: string; compileCmd: string; runCmd: string } {
  const cases = testCases
    .map((tc, i) => {
      const input = (tc.input as unknown[]) ?? [];
      const args = input.map((a) => `${shQuote(bashValue(a))}`).join(" ");
      const expected = normalize(tc.expected);
      const desc = tc.description ?? `case ${i + 1}`;
      return `run_case ${shQuote(desc)} ${shQuote(expected)} ${args}`;
    })
    .join("\n");

  const main = `#!/usr/bin/env bash
set -euo pipefail

${code}

run_case() {
  local desc="\$1"
  local expected="\$2"
  shift 2
  local out
  if ! out="\$(${h.entryFn} "\$@")"; then
    echo "E|\${desc}|exit=\$?"
    return
  fi
  out="\$(echo -n "\$out" | tr -d '\\r' | sed -e 's/[[:space:]]*$//')"
  if [ "\$out" = "\$expected" ]; then
    echo "P|\${desc}|\${expected}|\${out}"
  else
    echo "F|\${desc}|\${expected}|\${out}"
  fi
}

${cases}
`;

  return {
    main,
    compileCmd: "bash -n runner.sh",
    runCmd: "bash runner.sh"
  };
}