/**
 * C harness — same wire format as C++.
 * Strings arrive as `char*` (literals are copied by the harness), arrays as
 * (data, size) pairs via a small slice struct. Numeric types map directly.
 */

import type { Harness, TestCase } from "@cpd/core";

function cLiteral(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r") + '"';
}

function cValue(v: unknown): string {
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
  if (Array.isArray(v)) return "[" + v.map(cValue).join(",") + "]";
  throw new Error(`Unsupported C value: ${JSON.stringify(v)}`);
}

const PARSERS = `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

static void skip(const char* s, size_t* i) {
  while (s[*i] && (s[*i] == ' ' || s[*i] == ',' || s[*i] == '[' || s[*i] == ']')) (*i)++;
}
static long long parse_num(const char* s, size_t* i) {
  skip(s, i);
  long long sign = 1;
  if (s[*i] == '-') { sign = -1; (*i)++; }
  long long v = 0;
  while (s[*i] >= '0' && s[*i] <= '9') { v = v * 10 + (s[*i] - '0'); (*i)++; }
  return v * sign;
}
static double parse_dbl(const char* s, size_t* i) {
  skip(s, i);
  char tok[128]; size_t n = 0;
  while (s[*i] && ( (s[*i] >= '0' && s[*i] <= '9') || s[*i] == '.' || s[*i] == '-' || s[*i] == 'e' || s[*i] == 'E') && n < 127) tok[n++] = s[(*i)++];
  tok[n] = 0;
  return n ? atof(tok) : 0.0;
}
static char* parse_str(const char* s, size_t* i) {
  skip(s, i);
  if (s[*i] == '"') {
    (*i)++;
    char buf[8192]; size_t n = 0;
    while (s[*i] && s[*i] != '"' && n < 8191) {
      if (s[*i] == '\\\\' && s[*i + 1]) {
        (*i)++;
        if (s[*i] == 'n') buf[n++] = '\\n';
        else if (s[*i] == 't') buf[n++] = '\\t';
        else if (s[*i] == 'r') buf[n++] = '\\r';
        else buf[n++] = s[*i];
      } else buf[n++] = s[*i];
      (*i)++;
    }
    if (s[*i]) (*i)++;
    buf[n] = 0;
    char* r = (char*)malloc(n + 1);
    if (r) { memcpy(r, buf, n + 1); }
    return r;
  }
  size_t j = *i;
  while (s[j] && s[j] != ',' && s[j] != ']') j++;
  char* out = malloc(j - *i + 1);
  memcpy(out, s + *i, j - *i); out[j - *i] = 0;
  *i = j;
  return out;
}
typedef struct { int* data; size_t size; } int_vec;
typedef struct { long long* data; size_t size; } ll_vec;
typedef struct { double* data; size_t size; } dbl_vec;
typedef struct { char** data; size_t size; } str_vec;
static int_vec parse_vi(const char* s, size_t* i) {
  while (s[*i] == '[') (*i)++;
  int_vec v = {0, 0}; v.data = malloc(16 * sizeof(int)); v.size = 0;
  while (s[*i] && s[*i] != ']') { v.data[v.size++] = (int)parse_num(s, i); }
  if (s[*i]) (*i)++;
  return v;
}
static ll_vec parse_vll(const char* s, size_t* i) {
  while (s[*i] == '[') (*i)++;
  ll_vec v = {0, 0}; v.data = malloc(16 * sizeof(long long)); v.size = 0;
  while (s[*i] && s[*i] != ']') { v.data[v.size++] = parse_num(s, i); }
  if (s[*i]) (*i)++;
  return v;
}
static dbl_vec parse_vd(const char* s, size_t* i) {
  while (s[*i] == '[') (*i)++;
  dbl_vec v = {0, 0}; v.data = malloc(16 * sizeof(double)); v.size = 0;
  while (s[*i] && s[*i] != ']') { v.data[v.size++] = parse_dbl(s, i); }
  if (s[*i]) (*i)++;
  return v;
}
static str_vec parse_vs(const char* s, size_t* i) {
  while (s[*i] == '[') (*i)++;
  str_vec v = {0, 0}; v.data = malloc(16 * sizeof(char*)); v.size = 0;
  while (s[*i] && s[*i] != ']') { v.data[v.size++] = parse_str(s, i); }
  if (s[*i]) (*i)++;
  return v;
}
static void fmt_dbl(double v, char* out) { snprintf(out, 64, "%.9f", v); }
`;

function cParamType(t: string): string {
  switch (t) {
    case "int": return "int";
    case "long long": return "long long";
    case "double": return "double";
    case "bool": return "int";
    case "string": return "char*";
    case "vector<int>": return "int_vec";
    case "vector<long long>": return "ll_vec";
    case "vector<double>": return "dbl_vec";
    case "vector<string>": return "str_vec";
    default: return "char*";
  }
}

function cParseExpr(t: string, src: string, pos: string): string {
  switch (t) {
    case "int": return `(int)parse_num(${src}, &${pos})`;
    case "long long": return `parse_num(${src}, &${pos})`;
    case "double": return `parse_dbl(${src}, &${pos})`;
    case "bool": return `(int)parse_num(${src}, &${pos})`;
    case "string": return `parse_str(${src}, &${pos})`;
    case "vector<int>": return `parse_vi(${src}, &${pos})`;
    case "vector<long long>": return `parse_vll(${src}, &${pos})`;
    case "vector<double>": return `parse_vd(${src}, &${pos})`;
    case "vector<string>": return `parse_vs(${src}, &${pos})`;
    default: return `parse_str(${src}, &${pos})`;
  }
}

function cFormatExpr(t: string, r: string): string {
  switch (t) {
    case "int":
    case "long long": return `char _b[64]; snprintf(_b, 64, "%lld", (long long)${r}); char* actual = _b;`;
    case "double": return `char _b[64]; fmt_dbl(${r}, _b); char* actual = _b;`;
    case "bool": return `char* actual = ${r} ? "true" : "false";`;
    case "string": return `char* actual = ${r};`;
    default: {
      const elem = t === "vector<int>" ? `(long long)${r}.data[k]` : t === "vector<long long>" ? `${r}.data[k]` : t === "vector<double>" ? `(long long)(long double)${r}.data[k]` : `${r}.data[k]`;
      void elem;
      return `char _b[8192]; size_t _n = 0; _b[_n++] = '['; for (size_t k = 0; k < ${r}.size; k++) { if (k) _b[_n++] = ','; ${t === "vector<int>" || t === "vector<long long>" ? `_n += snprintf(_b + _n, 8192 - _n, "%lld", (long long)${r}.data[k]);` : t === "vector<double>" ? `char _t[64]; fmt_dbl(${r}.data[k], _t); size_t _tl = strlen(_t); memcpy(_b + _n, _t, _tl); _n += _tl;` : `size_t _tl = strlen(${r}.data[k]); memcpy(_b + _n, ${r}.data[k], _tl); _n += _tl;`} } _b[_n++] = ']'; _b[_n] = 0; char* actual = _b;`;
    }
  }
}

function cCompare(t: string, r: string, exp: string, isFloat: boolean): string {
  if (t.startsWith("vector<")) {
    const elem = isFloat ? `fabs((double)${r}.data[k] - (double)${exp}.data[k]) > 1e-6` : `${r}.data[k] != ${exp}.data[k]`;
    return `int ok = ${r}.size == ${exp}.size; if (ok) for (size_t k = 0; k < ${r}.size; k++) if (${elem}) { ok = 0; break; }`;
  }
  if (t === "string") return `int ok = strcmp(${r}, ${exp}) == 0;`;
  if (t === "double") return `int ok = fabs(${r} - ${exp}) <= 1e-6;`;
  if (t === "bool") return `int ok = (!!${r}) == (!!${exp});`;
  return `int ok = ${r} == ${exp};`;
}

export function generateCHarness(code: string, h: Harness, testCases: TestCase[]): { main: string; compileCmd: string; runCmd: string } {
  const argTypes = h.argTypes ?? (testCases[0]?.input as unknown[])?.map((a) => {
    if (typeof a === "number") return Number.isInteger(a) ? "int" : "double";
    if (typeof a === "boolean") return "bool";
    if (typeof a === "string") return "string";
    if (Array.isArray(a)) return "vector<int>";
    return "string";
  }) ?? [];
  const returnType = h.returnType ?? "int";
  const isFloat = h.comparator === "float" || h.comparator === "array_float" || returnType === "double";

  const cases = testCases
    .map((tc, i) => {
      const input = (tc.input as unknown[]) ?? [];
      const wire = input.map(cValue).join(",");
      const expected = cValue(tc.expected);
      const desc = tc.description ?? `case ${i + 1}`;
      return `{${cLiteral(wire)}, ${cLiteral(expected)}, ${cLiteral(desc)}}`;
    })
    .join(",\n");

  const paramTypes = argTypes.map(cParamType);
  const params = paramTypes.map((t, i) => `${t} a${i}`).join(", ");
  const callArgs = paramTypes.map((_, i) => `a${i}`).join(", ");

  const main = `${PARSERS}

${code}

typedef struct { const char* in; const char* expected; const char* desc; } Case;

int main(void) {
  const Case cases[] = {
${cases}
  };
  size_t ncases = sizeof(cases) / sizeof(Case);
  for (size_t ci = 0; ci < ncases; ci++) {
    const char* sin = cases[ci].in;
    const char* es = cases[ci].expected;
    size_t pos = 0, epos = 0;
    ${paramTypes.map((t, i) => `${t} a${i} = ${cParseExpr(argTypes[i]!, "sin", "pos")};`).join("\n    ")}
    ${returnType.startsWith("vector<") ? `${cParamType(returnType)} r = ${h.entryFn}(${callArgs});` : `${cParamType(returnType)} r = ${h.entryFn}(${callArgs});`}
    ${cFormatExpr(returnType, "r")}
    ${cCompare(returnType, "r", cParseExpr(returnType, "es", "epos"), isFloat)}
    if (ok) printf("P|%s|%s|%s\\n", cases[ci].desc, cases[ci].expected, actual);
    else printf("F|%s|%s|%s\\n", cases[ci].desc, cases[ci].expected, actual);
  }
  return 0;
}
`;

  return {
    main,
    compileCmd: "gcc -std=c11 -O1 -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer -o prog main.c",
    runCmd: "ASAN_OPTIONS=detect_leaks=0:abort_on_error=1 UBSAN_OPTIONS=halt_on_error=1 ./prog"
  };
}