import type { Harness, TestCase } from "@cpd/core";

/** Wire-format encoding of typed values so the C++ harness can parse them
 *  with plain streams (no JSON library inside the sandbox). Strings are
 *  emitted quoted with \-escapes (so spaces/commas survive); numbers/bools
 *  as plain text; arrays as [a,b,...]. */
function escapeString(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r");
}

export function cppValue(v: unknown): string {
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return '"' + escapeString(v) + '"';
  if (Array.isArray(v)) return "[" + v.map(cppValue).join(",") + "]";
  throw new Error(`Unsupported C++ value: ${JSON.stringify(v)}`);
}

/** C++ string-literal wrapper (escapes for the enclosing "" literal). */
function cppLiteral(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function guessArgTypes(h: Harness): string[] {
  if (!Array.isArray(h.args) || h.args.length === 0) return [];
  return h.args.map((a) => {
    if (typeof a === "number") return Number.isInteger(a) ? "int" : "double";
    if (typeof a === "boolean") return "bool";
    if (typeof a === "string") return "string";
    if (Array.isArray(a)) {
      const t = guessArgTypes({ ...h, args: a } as unknown as Harness)[0] ?? "int";
      return `vector<${t}>`;
    }
    return "string";
  });
}

export function cppArgTypes(h: Harness): string[] {
  return h.argTypes ?? guessArgTypes(h);
}

const TYPED_PARSERS = `
static long long parseNum(const string& s, size_t& i) {
  while (i < s.size() && (s[i] == ' ' || s[i] == ',' || s[i] == '[' || s[i] == ']')) i++;
  long long sign = 1; if (i < s.size() && s[i] == '-') { sign = -1; i++; }
  long long v = 0; while (i < s.size() && isdigit((unsigned char)s[i])) { v = v * 10 + (s[i] - '0'); i++; }
  return v * sign;
}
static double parseDbl(const string& s, size_t& i) {
  while (i < s.size() && (s[i] == ' ' || s[i] == ',' || s[i] == '[' || s[i] == ']')) i++;
  string tok; while (i < s.size() && (isdigit((unsigned char)s[i]) || s[i] == '.' || s[i] == '-' || s[i] == 'e' || s[i] == 'E')) tok.push_back(s[i++]);
  return tok.empty() ? 0.0 : stod(tok);
}
static string parseStr(const string& s, size_t& i) {
  while (i < s.size() && (s[i] == ' ' || s[i] == ',' || s[i] == '[' || s[i] == ']')) i++;
  if (i < s.size() && s[i] == '"') {
    i++; string t;
    while (i < s.size() && s[i] != '"') {
      if (s[i] == '\\\\' && i + 1 < s.size()) {
        i++;
        if (s[i] == 'n') t.push_back('\\n');
        else if (s[i] == 't') t.push_back('\\t');
        else if (s[i] == 'r') t.push_back('\\r');
        else t.push_back(s[i]);
      } else t.push_back(s[i]);
      i++;
    }
    if (i < s.size()) i++;
    return t;
  }
  size_t j = i; while (j < s.size() && s[j] != ',' && s[j] != ']') j++;
  string t = s.substr(i, j - i); i = j;
  return t;
}
static bool parseBool(const string& s, size_t& i) { return parseNum(s, i) != 0; }
static vector<long long> parseVll(const string& s, size_t& i) { while (i < s.size() && s[i] == '[') i++; vector<long long> v; while (i < s.size() && s[i] != ']') v.push_back(parseNum(s, i)); i++; return v; }
static vector<int> parseVi(const string& s, size_t& i) { auto v = parseVll(s, i); return vector<int>(v.begin(), v.end()); }
static vector<double> parseVd(const string& s, size_t& i) { while (i < s.size() && s[i] == '[') i++; vector<double> v; while (i < s.size() && s[i] != ']') v.push_back(parseDbl(s, i)); i++; return v; }
static vector<string> parseVs(const string& s, size_t& i) { while (i < s.size() && s[i] == '[') i++; vector<string> v; while (i < s.size() && s[i] != ']') v.push_back(parseStr(s, i)); i++; return v; }
`;

function cppExpr(type: string): string {
  switch (type) {
    case "int":
      return "(int)parseNum(sin, pos)";
    case "long long":
      return "parseNum(sin, pos)";
    case "double":
      return "parseDbl(sin, pos)";
    case "bool":
      return "parseBool(sin, pos)";
    case "string":
      return "parseStr(sin, pos)";
    case "vector<int>":
      return "parseVi(sin, pos)";
    case "vector<long long>":
      return "parseVll(sin, pos)";
    case "vector<double>":
      return "parseVd(sin, pos)";
    case "vector<string>":
      return "parseVs(sin, pos)";
    case "vector<vector<int>>":
      return "([]() -> vector<vector<int>> { vector<vector<int>> r; while (pos < sin.size()) { r.push_back(parseVi(sin, pos)); while (pos < sin.size() && sin[pos] == ']') { pos++; return r; } while (pos < sin.size() && sin[pos] != '[') pos++; } return r; })()";
    default:
      return "parseStr(sin, pos)";
  }
}

function cppParamType(t: string): string {
  return t.startsWith("vector<") ? `const ${t}&` : t;
}

function cppFormatExpr(type: string): string {
  switch (type) {
    case "int":
    case "long long":
      return "to_string(r)";
    case "double":
      return "fmtDbl(r)";
    case "bool":
      return "r ? \"true\" : \"false\"";
    case "string":
      return "r";
    default:
      if (type.startsWith("vector<")) return "fmtVec(r)";
      return "to_string(r)";
  }
}

export function generateCppHarness(code: string, h: Harness, testCases: TestCase[]): { main: string; compileCmd: string; runCmd: string } {
  const argTypes = cppArgTypes(h);
  const returnType = h.returnType ?? "int";
  const isFloatCmp = h.comparator === "float" || h.comparator === "array_float" || returnType === "double";

  const cases = testCases
    .map((tc, i) => {
      const input = (tc.input as unknown[]) ?? [];
      const wireInput = input.map((v) => cppValue(v)).join(",");
      const wireExpected = JSON.stringify(cppValue(tc.expected));
      const desc = tc.description ?? `case ${i + 1}`;
      return `{${cppLiteral(wireInput)}, ${wireExpected}, ${JSON.stringify(desc)}}`;
    })
    .join(",\n");

  const parseExpr = returnType.startsWith("vector<")
    ? returnType === "vector<int>"
      ? "parseVi(es, epos)"
      : returnType === "vector<double>"
        ? "parseVd(es, epos)"
        : returnType === "vector<string>"
          ? "parseVs(es, epos)"
          : "parseVll(es, epos)"
    : returnType === "double"
      ? "parseDbl(es, epos)"
      : returnType === "bool"
        ? "parseBool(es, epos)"
        : returnType === "string"
          ? "parseStr(es, epos)"
          : "parseNum(es, epos)";

  const compareStmts = `auto expVal = ${parseExpr};
  bool ok = false;
  if (${returnType.startsWith("vector<") ? "r.size() == expVal.size()" : "true"}) {
    ${returnType.startsWith("vector<")
      ? `ok = true;
    for (size_t k = 0; k < r.size(); k++) {
      if (${isFloatCmp ? `fabs((double)r[k] - (double)expVal[k]) > 1e-6` : `r[k] != expVal[k]`}) { ok = false; break; }
    }`
      : `ok = ${isFloatCmp ? `fabs((double)r - (double)expVal) <= 1e-6` : `r == expVal`};`}
  }`;

  const main = `#include <bits/stdc++.h>
using namespace std;

${TYPED_PARSERS}

static string fmtDbl(double v) { ostringstream os; os << setprecision(9) << v; return os.str(); }
template <typename T> static string fmtVec(const T& v) {
  ostringstream os; os << "[";
  for (size_t i = 0; i < v.size(); i++) { if (i) os << ","; os << v[i]; }
  os << "]"; return os.str();
}

${code}

int main() {
  struct Case { string in; string expected; string desc; };
  const vector<Case> cases = {
${cases}
  };
  for (const auto& c : cases) {
    string actual;
    try {
      size_t pos = 0, epos = 0;
      string sin = c.in, es = c.expected;
      ${argTypes.map((t, i) => `auto a${i} = ${cppExpr(t)};`).join("\n      ")}
      auto r = ${h.entryFn}(${argTypes.map((_, i) => `a${i}`).join(", ")});
      actual = ${cppFormatExpr(returnType)};
      ${compareStmts}
      cout << (ok ? "P" : "F") << "|" << c.desc << "|" << c.expected << "|" << actual << "\\n";
    } catch (const exception& e) {
      cout << "E|" << c.desc << "|" << e.what() << "|" << actual << "\\n";
    }
  }
  return 0;
}
`;

  return {
    main,
    compileCmd: "g++ -std=c++20 -O1 -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer -o prog main.cpp",
    runCmd: "ASAN_OPTIONS=detect_leaks=0:abort_on_error=1 UBSAN_OPTIONS=halt_on_error=1 ./prog"
  };
}