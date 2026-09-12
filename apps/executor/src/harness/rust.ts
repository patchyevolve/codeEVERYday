/**
 * Rust harness — same wire format as the C++ harness:
 * numbers plain, bools 1/0, strings quoted with \\-escapes, arrays [a,b,...].
 * Prints the same P|desc|expected|actual / E|desc|err output contract.
 */

import type { Harness, TestCase } from "@cpd/core";

function rustLiteral(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function rustValue(v: unknown): string {
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
  if (Array.isArray(v)) return "[" + v.map(rustValue).join(",") + "]";
  throw new Error(`Unsupported Rust value: ${JSON.stringify(v)}`);
}

const PARSERS = `
fn skip(s: &[u8], i: &mut usize) {
  while *i < s.len() && (s[*i] == b' ' || s[*i] == b',' || s[*i] == b'[' || s[*i] == b']') { *i += 1; }
}
fn parse_num(s: &[u8], i: &mut usize) -> i64 {
  skip(s, i);
  let mut neg = false;
  if *i < s.len() && s[*i] == b'-' { neg = true; *i += 1; }
  let mut v: i64 = 0;
  while *i < s.len() && s[*i].is_ascii_digit() { v = v * 10 + (s[*i] - b'0') as i64; *i += 1; }
  if neg { -v } else { v }
}
fn parse_dbl(s: &[u8], i: &mut usize) -> f64 {
  skip(s, i);
  let start = *i;
  while *i < s.len() && (s[*i].is_ascii_digit() || matches!(s[*i], b'.' | b'-' | b'e' | b'E')) { *i += 1; }
  std::str::from_utf8(&s[start..*i]).ok().and_then(|t| t.parse().ok()).unwrap_or(0.0)
}
fn parse_str(s: &[u8], i: &mut usize) -> String {
  skip(s, i);
  if *i < s.len() && s[*i] == b'"' {
    *i += 1;
    let mut out = String::new();
    while *i < s.len() && s[*i] != b'"' {
      if s[*i] == b'\\\\' && *i + 1 < s.len() {
        *i += 1;
        match s[*i] {
          b'n' => out.push('\\n'),
          b't' => out.push('\\t'),
          b'r' => out.push('\\r'),
          c => out.push(c as char),
        }
      } else { out.push(s[*i] as char); }
      *i += 1;
    }
    if *i < s.len() { *i += 1; }
    out
  } else {
    let start = *i;
    while *i < s.len() && s[*i] != b',' && s[*i] != b']' { *i += 1; }
    std::str::from_utf8(&s[start..*i]).unwrap_or("").to_string()
  }
}
fn parse_vi(s: &[u8], i: &mut usize) -> Vec<i32> { while *i < s.len() && s[*i] == b'[' { *i += 1; } let mut v = Vec::new(); while *i < s.len() && s[*i] != b']' { v.push(parse_num(s, i) as i32); } if *i < s.len() { *i += 1; } v }
fn parse_vll(s: &[u8], i: &mut usize) -> Vec<i64> { while *i < s.len() && s[*i] == b'[' { *i += 1; } let mut v = Vec::new(); while *i < s.len() && s[*i] != b']' { v.push(parse_num(s, i)); } if *i < s.len() { *i += 1; } v }
fn parse_vd(s: &[u8], i: &mut usize) -> Vec<f64> { while *i < s.len() && s[*i] == b'[' { *i += 1; } let mut v = Vec::new(); while *i < s.len() && s[*i] != b']' { v.push(parse_dbl(s, i)); } if *i < s.len() { *i += 1; } v }
fn parse_vs(s: &[u8], i: &mut usize) -> Vec<String> { while *i < s.len() && s[*i] == b'[' { *i += 1; } let mut v = Vec::new(); while *i < s.len() && s[*i] != b']' { v.push(parse_str(s, i)); } if *i < s.len() { *i += 1; } v }
`;

function rustType(t: string): string {
  switch (t) {
    case "int": return "i32";
    case "long long": return "i64";
    case "double": return "f64";
    case "bool": return "bool";
    case "string": return "String";
    case "vector<int>": return "Vec<i32>";
    case "vector<long long>": return "Vec<i64>";
    case "vector<double>": return "Vec<f64>";
    case "vector<string>": return "Vec<String>";
    default: return "String";
  }
}

function parseExpr(t: string, src: string, pos: string): string {
  switch (t) {
    case "int": return `parse_num(${src}, &mut ${pos}) as i32`;
    case "long long": return `parse_num(${src}, &mut ${pos})`;
    case "double": return `parse_dbl(${src}, &mut ${pos})`;
    case "bool": return `parse_num(${src}, &mut ${pos}) != 0`;
    case "string": return `parse_str(${src}, &mut ${pos})`;
    case "vector<int>": return `parse_vi(${src}, &mut ${pos})`;
    case "vector<long long>": return `parse_vll(${src}, &mut ${pos})`;
    case "vector<double>": return `parse_vd(${src}, &mut ${pos})`;
    case "vector<string>": return `parse_vs(${src}, &mut ${pos})`;
    default: return `parse_str(${src}, &mut ${pos})`;
  }
}

function fmtExpr(t: string, r: string): string {
  switch (t) {
    case "int":
    case "long long":
      return `${r}.to_string()`;
    case "double":
      return `format!("{:.9}", ${r})`;
    case "bool":
      return `if ${r} { "true".to_string() } else { "false".to_string() }`;
    case "string":
      return `${r}.to_string()`;
    case "vector<int>":
      return `format!("[{}]", ${r}.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(","))`;
    case "vector<long long>":
      return `format!("[{}]", ${r}.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(","))`;
    case "vector<double>":
      return `format!("[{}]", ${r}.iter().map(|x| format!("{:.9}", x)).collect::<Vec<_>>().join(","))`;
    case "vector<string>":
      return `format!("[{}]", ${r}.iter().map(|x| x.clone()).collect::<Vec<_>>().join(","))`;
    default:
      return `format!("{:?}", ${r})`;
  }
}

function compareStmts(t: string, r: string, expectedSrc: string, pos: string, isFloat: boolean): string {
  const exp = parseExpr(t, expectedSrc, pos);
  if (t.startsWith("vector<")) {
    const elem = isFloat ? `((a - b).abs() > 1e-6)` : `(a != b)`;
    const cmp = t === "vector<double>" ? "a - b" : "a != b";
    void cmp;
    const inner = isFloat
      ? `let mut ok = true; if ${r}.len() == ${exp}.len() { for (a, b) in ${r}.iter().zip(${exp}.iter()) { if ${elem} { ok = false; break; } } } else { ok = false; }`
      : `let mut ok = true; if ${r}.len() == ${exp}.len() { for (a, b) in ${r}.iter().zip(${exp}.iter()) { if a != b { ok = false; break; } } } else { ok = false; }`;
    return inner;
  }
  if (t === "double") return `let ok = (${r} - ${exp}).abs() <= 1e-6;`;
  if (t === "string") return `let ok = ${r} == ${exp};`;
  if (t === "bool") return `let ok = ${r} == ${exp};`;
  return `let ok = ${r} == ${exp};`;
}

export function generateRustHarness(code: string, h: Harness, testCases: TestCase[]): { main: string; compileCmd: string; runCmd: string } {
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
      const wire = input.map(rustValue).join(",");
      const expected = rustValue(tc.expected);
      const desc = tc.description ?? `case ${i + 1}`;
      return `Case { input: ${rustLiteral(wire)}, expected: ${rustLiteral(expected)}, desc: ${rustLiteral(desc)} }`;
    })
    .join(",\n");

  const paramTypes = argTypes.map((t) => rustType(t));
  const params = paramTypes.map((t, i) => `a${i}: ${t}`).join(", ");
  const callArgs = paramTypes.map((_t, i) => `a${i}`).join(", ");

  const main = `${PARSERS}

${code}

struct Case {
  input: &'static str,
  expected: &'static str,
  desc: &'static str,
}

fn main() {
  let cases = vec![
${cases}
  ];
  for c in cases {
    let sin = c.input.as_bytes();
    let mut pos = 0usize;
    let mut epos = 0usize;
    let a0: ${paramTypes[0] ?? "i32"} = ${paramTypes[0] ? parseExpr(argTypes[0]!, "sin", "pos") : "0"};
${paramTypes.slice(1).map((t, i) => `    let a${i + 1}: ${t} = ${parseExpr(argTypes[i + 1]!, "sin", "pos")};`).join("\n")}
    let r = ${h.entryFn}(${callArgs});
    let actual = ${fmtExpr(returnType, "r")};
    ${compareStmts(returnType, "r", "c.expected.as_bytes()", "epos", isFloat)}
    if ok {
      println!("P|{}|{}|{}", c.desc, c.expected, actual);
    } else {
      println!("F|{}|{}|{}", c.desc, c.expected, actual);
    }
  }
}
`;

  return {
    main,
    compileCmd: "rustc -O -o prog main.rs",
    runCmd: "./prog"
  };
}