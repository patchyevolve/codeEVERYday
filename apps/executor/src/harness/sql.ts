/**
 * SQL harness — learner writes SQL (final statement must be the answer query).
 * schema.sql is executed first (DDL + seed), then the solution script; the
 * final SELECT's rows are compared against the expected row set (multiset).
 * Output: P|desc|json-expected|json-actual
 */

import type { Harness, TestCase } from "@cpd/core";

/** Split SQL on top-level semicolons, respecting single-quoted strings and
 *  double-quoted identifiers. Trailing semicolons are dropped. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inSq = false;
  let inDq = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (inSq) {
      cur += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          cur += sql[i + 1]!;
          i++;
        } else {
          inSq = false;
        }
      }
      continue;
    }
    if (inDq) {
      cur += ch;
      if (ch === '"') inDq = false;
      continue;
    }
    if (ch === "'") {
      inSq = true;
      cur += ch;
      continue;
    }
    if (ch === '"') {
      inDq = true;
      cur += ch;
      continue;
    }
    if (ch === ";") {
      const t = cur.trim();
      if (t) out.push(t);
      cur = "";
      continue;
    }
    cur += ch;
  }
  const t = cur.trim();
  if (t) out.push(t);
  return out;
}

export function generateSqlHarness(code: string, h: Harness, testCases: TestCase[]): { main: string; compileCmd: string; runCmd: string } {
  const schema = h.schema ?? "";
  const cases = testCases
    .map((tc, i) => {
      const expected = JSON.stringify(tc.expected ?? []);
      const desc = JSON.stringify(tc.description ?? `case ${i + 1}`);
      return `  { "desc": ${desc}, "expected": ${expected} }`;
    })
    .join(",\n");

  const runner = `import json, sqlite3, sys

schema = open("schema.sql", encoding="utf-8").read()
solution = open("solution.sql", encoding="utf-8").read()

cases = [
${cases}
]

def split_sql(text):
    out = []
    cur = ""
    in_sq = False
    in_dq = False
    i = 0
    while i < len(text):
        ch = text[i]
        if in_sq:
            cur += ch
            if ch == "'":
                if i + 1 < len(text) and text[i + 1] == "'":
                    cur += text[i + 1]
                    i += 1
                else:
                    in_sq = False
            i += 1
            continue
        if in_dq:
            cur += ch
            if ch == '"':
                in_dq = False
            i += 1
            continue
        if ch == "'":
            in_sq = True
            cur += ch
        elif ch == '"':
            in_dq = True
            cur += ch
        elif ch == ";":
            if cur.strip():
                out.append(cur.strip())
            cur = ""
        else:
            cur += ch
        i += 1
    if cur.strip():
        out.append(cur.strip())
    return out

con = sqlite3.connect(":memory:")
try:
    con.executescript(schema)
    stmts = split_sql(solution)
    if not stmts:
        print("E|empty|no statements in solution")
        sys.exit(0)
    verify = ${h.verificationQuery ? JSON.stringify(h.verificationQuery) : "None"}
    if verify:
        con.executescript(";".join(stmts))
        cur = con.execute(verify)
        rows = [list(r) for r in cur.fetchall()]
    else:
        # statements before the last run as a script; the last must be a SELECT
        if len(stmts) > 1:
            con.executescript(";".join(stmts[:-1]))
        cur = con.execute(stmts[-1])
        if cur.description is None:
            print("E|final|final statement is not a query")
            sys.exit(0)
        rows = [list(r) for r in cur.fetchall()]
except Exception as e:
    print("E|error|" + str(e).replace("|", " "))
    sys.exit(0)

actual = json.dumps(rows, default=str)
passed = True
failed_desc = ""
expected_any = ""
actual_any = ""
for ci, c in enumerate(cases):
    exp = json.dumps(c["expected"], default=str)
    same = sorted(map(str, rows)) == sorted(map(str, c["expected"]))
    if not same:
        passed = False
        failed_desc = c["desc"]
        expected_any = exp
        actual_any = actual
        break
if passed:
    print("P|" + cases[0]["desc"] + "|" + json.dumps(cases[0]["expected"], default=str) + "|" + actual)
else:
    print("F|" + failed_desc + "|" + expected_any + "|" + actual_any)
`;

  return {
    main: runner,
    compileCmd: "python3 -c \"import sqlite3; sqlite3.connect(':memory:')\"",
    runCmd: "python3 runner.py"
  };
}