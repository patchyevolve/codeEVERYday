# Curriculum Content Authoring Spec (v1)

You are writing seed content for a tutor-controlled coding apprenticeship system.
Content lives as JSON data files in `packages/curriculum/data/` and is validated
against the zod schema in `packages/curriculum/src/content-schema.ts`.

## File layout

- `cpp-fundamentals.json` — C++ module "Fundamentals"
- `cpp-memory.json` — C++ module "Memory"
- `cpp-dsa.json` — C++ module "Data Structures & Algorithms"
- `cpp-oop.json` — C++ module "Object-Oriented Programming"
- `python-fundamentals.json` — Python track "Python Fundamentals"

Each file: `{ "version": 1, "tracks": [ { "languageKey", "languageName", "modules": [...] } ] }`

## Hierarchy

`module -> topic -> concept`. Each concept has:
- `lesson` — teaching content (markdown sections)
- `exercises` — 3-4 exercises (CODING + CONCEPTUAL/TRACING/PREDICTION/DEBUGGING mix)
- `assessment` — 4-6 questions (MCQ-heavy, max 1 EXPLAIN)

## The 9 levels

0 Absolute Fundamentals, 1 Basic Programming, 2 Problem Solving, 3 Data Structures,
4 Algorithms, 5 Intermediate Software Development, 6 Advanced Programming,
7 Systems / Architecture, 8 Professional Engineering

Module `levelGate`: fundamentals=0, memory=1, dsa=2, oop=3, advanced=4+.

## Lesson structure (MANDATORY sequence)

8-14 sections, each `{ type: "markdown"|"code"|"callout", title, content, language?, calloutKind? }`.
Order and include ALL of:

1. **The problem it solves** — what goes wrong without this concept (real motivation)
2. **Mental model** — an intuition (analogy, picture in words)
3. **Simple example** — smallest possible code example (`type: "code"`, `language: "cpp"`)
4. **Why it works** — mechanism, not just behavior
5. **Common mistakes** (`calloutKind: "common-mistake"`) — 2-3 concrete bugs with wrong vs right code
6. **Real-world use** (`calloutKind: "real-world"`) — where this appears in real systems
7. **When NOT to use it** — tradeoffs, alternatives
8. **What you just learned** — 3-5 bullet recap

For C++ memory concepts, ALSO include engineering consequences (lifetime, ownership,
perf, UB). Never write lessons like "X is Y. Now solve this problem." — the lesson
must teach, then exercises practice.

## Exercise kinds

- **CODING** — harness + scaffold + referenceSolution + hints (3-4 progressive) + explanationMd
- **DEBUGGING** — scaffold contains a deliberate bug; user fixes it. harness + referenceSolution (fixed)
- **TRACING** — show code, user predicts the output → `answer: { kind: "text", accepted: ["..."] }`
- **PREDICTION** — show code, ask "what happens / what is the value" → text answer
- **CONCEPTUAL** — MCQ: `answer: { kind: "mcq", options: [...], answerIndex: n }`

Every exercise needs: promptMd (real problem statement, >= 20 chars), difficulty 1-5,
estMinutes, hints (>= 2 for coding/debugging), explanationMd, mistakePattern
(from the list below) for CODING/DEBUGGING, tags.

## C++ coding exercise conventions (CRITICAL)

- `scaffold` = ONLY the function(s), no `#include`, no `main()`. The executor wraps
  it with `#include <bits/stdc++.h>`.
- `harness`:
  ```json
  {
    "language": "cpp",
    "entryFn": "maxPairSum",
    "args": "auto",
    "argTypes": ["vector<int>", "int"],
    "returnType": "int",
    "comparator": "exact"
  }
  ```
  - Allowed argTypes: `int, long long, double, string, bool, vector<int>, vector<long long>, vector<double>, vector<string>`
  - Allowed returnType: same set.
  - comparator: `exact` (numbers/strings/bool), `float` (double epsilon), `array` / `array_float` (NUMERIC arrays only — never arrays of strings with array comparator), `map` (not for C++).
  - test cases: `[{ "input": [2, 3], "expected": 5, "description": "basic" }]` —
    `input` is the ARRAY OF ARGUMENTS.
- `referenceSolution` MUST compile and pass ALL test cases. Use `std::vector`, `std::string`.
- Include edge cases: empty input, single element, negatives, large values, duplicates.
- 4-8 test cases per exercise.
- Keep `#include` out of scaffold; you MAY use any of bits/stdc++.h facilities.

## Python coding exercise conventions

- scaffold = only `def fn(a, b):` body, no imports beyond stdlib, no top-level code.
- harness: `{ "language": "python", "entryFn": "max_pair_sum", "args": "auto", "comparator": "exact" }`
  (argTypes optional for python; lists/dicts/numbers/strings/bools all fine).
- `answer: {kind:"mcq"}` for conceptual; text/checklist also allowed.

## Assessment format

`{ "title", "estMinutes", "passThreshold": 0.7, "questions": [...] }`
- MCQ: `{ kind: "MCQ", prompt, options: [...4], answerIndex, explanation, points }`
- EXPLAIN (max 1 per assessment): `{ kind: "EXPLAIN", prompt, explanation, points }`
- Mix recall + application. 4-6 questions.

## mistakePattern allowed values

`off_by_one, wrong_operator, null_deref, uninitialized, mem_leak, type_error,
overflow, boundary_check, logic_error, complexity_error, misread_problem, syntax_error, wrong_signature`

## Content quality bar

- Teaching must explain WHY, not just WHAT. Include tradeoffs and engineering consequences.
- C++ content must be C++-specific (lifetime, value semantics, UB, perf).
- Difficulty 1 = trivial, 3 = medium, 5 = hard.
- Every lesson for a concept must reference the learner model: assume learner just passed prerequisites.

## Module skeletons to author

### cpp-fundamentals.json (languageKey "cpp")
Module "Fundamentals" (position 0, levelGate 0) — topic "Getting Started":
- concept `variables` — int/double/bool/char, initialization vs assignment, naming, scope intro
- concept `types` — integer types, sizes, narrowing, overflow, casts, auto
- concept `operators` — arithmetic, comparison, logical, precedence, modulo, integer division
- concept `control-flow` — if/else, switch, loops (while/for/do), break/continue, loop vs recursion intro
- concept `functions` — declaration/definition, parameters by value, return, default args, overloads, stack frames

### cpp-memory.json
Module "Memory" (position 1, levelGate 1) — topic "Memory Model":
- concept `stack-heap` — stack vs heap, lifetime, allocation cost, fragmentation
- concept `pointers` — address-of, dereference, pointer arithmetic, null, dangling
- concept `references` — reference vs pointer, aliasing, const refs, why references exist
- concept `dynamic-memory` — new/delete, leaks, double-free, ownership
- concept `raii` — RAII, smart pointers, why C++ uses destructors, move semantics intro

### cpp-dsa.json
Module "Data Structures & Algorithms" (position 2, levelGate 2):
- topic "Arrays": concept `dynamic-arrays` (std::vector internals, resize, amortized) — includes implementing a mini dynamic array
- topic "Complexity": concept `big-o` (what/why, common classes, measurement)
- topic "Searching": concept `linear-search`, concept `binary-search`
- topic "Sorting": concept `sorting-basics` (selection sort implementation), concept `merge-sort` (recursion, O(n log n))

### cpp-oop.json
Module "Object-Oriented Programming" (position 3, levelGate 3):
- topic "Classes": concept `classes` (struct vs class, members, constructors, this), concept `encapsulation` (access control, invariants), concept `inheritance` (is-a, base/derived, virtual intro)

### python-fundamentals.json (languageKey "python")
Module "Python Fundamentals" (position 0, levelGate 0):
- topic "Basics": concept `py-variables-types` (dynamic typing, int/float/str/bool, None), concept `py-control-flow` (if/elif/else, for, while, range, enumerate), concept `py-functions` (def, return, default args, docstrings), concept `py-lists` (list ops, slicing, comprehension), concept `py-dicts` (dict ops, keys/values, hashing intro)

Python modules share concepts with C++ where sensible but MUST be Python-specific content.

## Output requirements

Write the complete JSON files. Do not truncate. Each file must parse as JSON.
Concept `slug` values: lowercase, hyphen-separated, unique within topic.