import type { Harness, TestCase } from "@cpd/core";

export function generatePythonRunner(code: string, h: Harness, testCases: TestCase[]): { main: string; runCmd: string } {
  const cases = testCases.map((tc, i) => ({
    input: Array.isArray(tc.input) ? tc.input : [tc.input],
    expected: tc.expected,
    description: tc.description ?? `case ${i + 1}`
  }));

  const comparator = h.comparator;
  const eps = 1e-6;

  const casesJson = JSON.stringify(cases);

  const main = `import json, sys, math, traceback

def _fmt(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return repr(round(v, 9))
    if isinstance(v, list):
        return "[" + ",".join(_fmt(x) for x in v) + "]"
    if isinstance(v, dict):
        return json.dumps(v, sort_keys=True, separators=(",", ":"))
    return str(v)

def _eq(actual, expected):
    cmp = ${JSON.stringify(comparator)}
    if cmp in ("float", "array_float"):
        return abs(float(actual) - float(expected)) <= ${eps}
    if cmp == "array":
        if isinstance(expected, list) and isinstance(actual, list):
            if len(actual) != len(expected):
                return False
            return all(_eq(a, e) for a, e in zip(actual, expected))
    if isinstance(expected, bool) or isinstance(actual, bool):
        return actual is expected
    if isinstance(expected, float) or isinstance(actual, float):
        return abs(float(actual) - float(expected)) <= ${eps}
    if isinstance(expected, list) and isinstance(actual, list):
        return len(actual) == len(expected) and all(_eq(a, e) for a, e in zip(actual, expected))
    return actual == expected

${code}

cases = json.loads(${JSON.stringify(casesJson)})
for c in cases:
    try:
        result = ${h.entryFn}(*c["input"])
        actual = _fmt(result)
        ok = _eq(result, c["expected"])
        print(("P" if ok else "F") + "|" + str(c["description"]) + "|" + _fmt(c["expected"]) + "|" + actual)
    except Exception as e:
        print("E|" + str(c.get("description", "?")) + "|" + type(e).__name__ + ": " + str(e) + "|")
`;

  return {
    main,
    runCmd: "python3 runner.py"
  };
}