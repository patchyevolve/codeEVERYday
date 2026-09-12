/**
 * Assembly harness (x86-64, AT&T syntax, GNU as via gcc:latest).
 * User writes `func.s` implementing the entry function per the System V ABI
 * (first 6 integer args in rdi/rsi/rdx/rcx/r8/r9, return in rax).
 * A C main harness parses the wire input, calls the function, prints results.
 * Integer scalars only (i64); max 6 args.
 */

import type { Harness, TestCase } from "@cpd/core";

function cLiteral(v: unknown): string {
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error("asm harness: float args not supported");
    return String(v);
  }
  if (typeof v === "boolean") return v ? "1" : "0";
  throw new Error("asm harness: unsupported arg type");
}

export function generateAsmHarness(code: string, h: Harness, testCases: TestCase[]): { main: string; compileCmd: string; runCmd: string } {
  const params = Array.from({ length: 6 }, (_, i) => `long long a${i}`);
  const sig = `extern long long ${h.entryFn}(${params.join(", ")});`;

  const cases = testCases
    .map((tc, i) => {
      const input = (tc.input as unknown[]) ?? [];
      const literals = input.map((v) => cLiteral(v)).join(", ");
      const expected = typeof tc.expected === "number" ? String(tc.expected) : JSON.stringify(tc.expected);
      const desc = JSON.stringify(tc.description ?? `case ${i + 1}`);
      return `  { .desc = ${desc}, .expected = ${expected}, .args = (long long[]){ ${literals} }, .n = ${input.length} }`;
    })
    .join(",\n");

  const main = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

${sig}

typedef struct { const char* desc; long long expected; long long* args; int n; } Case;

int main(void) {
  Case cases[] = {
${cases}
  };
  for (size_t k = 0; k < sizeof(cases) / sizeof(cases[0]); k++) {
    Case* c = &cases[k];
    long long a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0;
    if (c->n > 0) a0 = c->args[0];
    if (c->n > 1) a1 = c->args[1];
    if (c->n > 2) a2 = c->args[2];
    if (c->n > 3) a3 = c->args[3];
    if (c->n > 4) a4 = c->args[4];
    if (c->n > 5) a5 = c->args[5];
    long long r = ${h.entryFn}(a0, a1, a2, a3, a4, a5);
    if (r == c->expected) {
      printf("P|%s|%lld|%lld\\n", c->desc, c->expected, r);
    } else {
      printf("F|%s|%lld|%lld\\n", c->desc, c->expected, r);
    }
  }
  return 0;
}
`;

  return {
    main,
    compileCmd: "gcc -O1 -o prog main.c func.s",
    runCmd: "./prog"
  };
}