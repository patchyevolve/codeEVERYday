import type { ExecutorLanguage } from "@cpd/core";
/**
 * Deterministic coding-exercise archetypes used when no AI provider is
 * configured or AI output fails validation. Each archetype has fixed,
 * pre-verified reference code; only numeric/string parameters vary via a
 * seeded RNG. Test cases are generated alongside and verified by running
 * the reference solution through the sandbox before the item is published.
 */

import type { Harness, TestCase } from "@cpd/core";
import type { GenContext } from "../content.js";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ArchetypeParams {
  n: number;
  values: number[];
  words: string[];
  s: string;
}

export interface CodingArchetype {
  id: string;
  languages: ExecutorLanguage[];
  difficulty: number;
  title(ctx: GenContext, p: ArchetypeParams): string;
  prompt(ctx: GenContext, p: ArchetypeParams): string;
  harness(language: string, ctx: GenContext): Harness;
  scaffold(language: string, ctx: GenContext): string;
  reference(language: string, ctx: GenContext): string;
  testCases(language: string, ctx: GenContext, p: ArchetypeParams): TestCase[];
  explanation(ctx: GenContext): string;
  hints(): { threshold: number; text: string }[];
  mistakePattern(): string;
  buggyScaffold?(language: string, ctx: GenContext): string;
}

function randValues(rng: () => number, count: number, lo: number, hi: number): number[] {
  return Array.from({ length: count }, () => lo + Math.floor(rng() * (hi - lo + 1)));
}

const VOWELS = "aeiouAEIOU";

/* ------------------------------------------------------------------ */
/* C++ archetypes                                                      */
/* ------------------------------------------------------------------ */

const cppSumRange: CodingArchetype = {
  id: "cpp_sum_range",
  languages: ["cpp"],
  difficulty: 2,
  title: (_c, p) => `Sum of integers from ${p.n - 5} to ${p.n + 5}`,
  prompt: (_c, p) =>
    `Write a function \`sumRange(int a, int b)\` that returns the sum of every integer from \`a\` to \`b\` inclusive.

For example, \`sumRange(1, 4)\` returns \`10\` (1+2+3+4).

**Constraints:** \`a\` may be greater than \`b\` — in that case return \`0\` (an empty range). Use a simple loop. Watch for large values: keep the total in a \`long long\` and return it as \`long long\` so intermediate sums cannot overflow.

Test with a=${p.n - 5}, b=${p.n + 5}: the answer is ${((p.n - 5 + p.n + 5) * 11) / 2}.`,
  harness: () => ({
    language: "cpp",
    entryFn: "sumRange",
    args: "auto",
    argTypes: ["long long", "long long"],
    returnType: "long long",
    comparator: "exact"
  }),
  scaffold: () => `long long sumRange(long long a, long long b) {
    // TODO: return the sum of all integers in [a, b], or 0 if a > b
    return 0;
}`,
  reference: () => `long long sumRange(long long a, long long b) {
    if (a > b) return 0;
    long long total = 0;
    for (long long i = a; i <= b; i++) total += i;
    return total;
}`,
  testCases: (_l, _c, p) => [
    { input: [1, 4], expected: 10, description: "basic 1..4" },
    { input: [p.n - 5, p.n + 5], expected: ((p.n - 5 + p.n + 5) * 11) / 2, description: "parameterized range" },
    { input: [5, 1], expected: 0, description: "a > b returns 0" },
    { input: [-3, 3], expected: 0, description: "symmetric negative" },
    { input: [0, 0], expected: 0, description: "single zero" },
    { input: [-7, -2], expected: -27, description: "negative range" },
    { input: [1000000, 1000010], expected: 11000055, description: "large values" }
  ],
  explanation: () =>
    "The loop accumulates every integer in the inclusive range. The `a > b` guard handles the empty range. Using `long long` avoids overflow for large ranges; note that `int` would overflow here, which is why the signature uses 64-bit integers.",
  hints: () => [
    { threshold: 2, text: "Iterate from a to b with a for loop and accumulate into a running total." },
    { threshold: 4, text: "Handle the case a > b first — an empty range should return 0, not a negative sum." },
    { threshold: 6, text: "Return type is long long so the total cannot overflow int — keep the accumulator in long long." }
  ],
  mistakePattern: () => "off_by_one"
};

const cppMaxElement: CodingArchetype = {
  id: "cpp_max_element",
  languages: ["cpp"],
  difficulty: 1,
  title: (_c, p) => `Largest element in a vector (size ${p.values.length})`,
  prompt: (_c, p) =>
    `Write a function \`int maxElement(const std::vector<int>& v)\` that returns the largest value in the vector.

The vector is **never empty** in the test cases. Compare every element with the best found so far.

Test data: vector = {${p.values.join(", ")}} → answer ${Math.max(...p.values)}.`,
  harness: () => ({
    language: "cpp",
    entryFn: "maxElement",
    args: "auto",
    argTypes: ["vector<int>"],
    returnType: "int",
    comparator: "exact"
  }),
  scaffold: () => `int maxElement(const std::vector<int>& v) {
    // TODO: return the maximum value in v (v is never empty)
    return 0;
}`,
  reference: () => `int maxElement(const std::vector<int>& v) {
    int best = v[0];
    for (size_t i = 1; i < v.size(); i++) {
        if (v[i] > best) best = v[i];
    }
    return best;
}`,
  testCases: (_l, _c, p) => [
    { input: [[5]], expected: 5, description: "single element" },
    { input: [[-1, -7, -3]], expected: -1, description: "all negative" },
    { input: [p.values], expected: Math.max(...p.values), description: "parameterized" },
    { input: [[10, 20, 30, 40, 50]], expected: 50, description: "sorted ascending" },
    { input: [[7, 3, 7, 3, 7]], expected: 7, description: "duplicates" }
  ],
  explanation: () =>
    "Keep a running best value, initialized from the first element (safe because the vector is never empty), then scan the rest. This is a single O(n) pass — you cannot do better since every element must be inspected.",
  hints: () => [
    { threshold: 2, text: "Initialize your answer with the FIRST element of the vector, not with 0 (that breaks for all-negative inputs)." },
    { threshold: 4, text: "Loop over the remaining elements and update the best value whenever you find something larger." }
  ],
  mistakePattern: () => "uninitialized"
};

const cppCountEven: CodingArchetype = {
  id: "cpp_count_even",
  languages: ["cpp"],
  difficulty: 1,
  title: (_c, p) => `Count even numbers (vector of ${p.values.length})`,
  prompt: (_c, p) =>
    `Write a function \`int countEven(const std::vector<int>& v)\` that returns how many values in the vector are even (divisible by 2).

Remember: \`x % 2 == 0\` is the even test, and it works for negative numbers too in C++.

Test data: vector = {${p.values.join(", ")}} → answer ${p.values.filter((x) => x % 2 === 0).length}.`,
  harness: () => ({
    language: "cpp",
    entryFn: "countEven",
    args: "auto",
    argTypes: ["vector<int>"],
    returnType: "int",
    comparator: "exact"
  }),
  scaffold: () => `int countEven(const std::vector<int>& v) {
    // TODO: return the count of even numbers in v
    return 0;
}`,
  reference: () => `int countEven(const std::vector<int>& v) {
    int count = 0;
    for (int x : v) {
        if (x % 2 == 0) count++;
    }
    return count;
}`,
  testCases: (_l, _c, p) => [
    { input: [[]], expected: 0, description: "empty vector" },
    { input: [[2, 4, 6]], expected: 3, description: "all even" },
    { input: [[1, 3, 5]], expected: 0, description: "all odd" },
    { input: [p.values], expected: p.values.filter((x) => x % 2 === 0).length, description: "parameterized" },
    { input: [[-2, -3, 0, 4]], expected: 3, description: "negatives and zero" }
  ],
  explanation: () =>
    "Iterate with a range-for and test each value with the modulo operator. Zero is even, and in C++ negative even numbers also satisfy x % 2 == 0, so the same test covers everything.",
  hints: () => [
    { threshold: 2, text: "Use a range-based for loop: for (int x : v) { ... }." },
    { threshold: 4, text: "The even test in C++ is x % 2 == 0 — it already works for negative numbers and zero." }
  ],
  mistakePattern: () => "wrong_operator"
};

const cppDoubleValues: CodingArchetype = {
  id: "cpp_double_values",
  languages: ["cpp"],
  difficulty: 1,
  title: (_c, p) => `Double every element (vector of ${p.values.length})`,
  prompt: (_c, p) =>
    `Write a function \`std::vector<int> doubleValues(const std::vector<int>& v)\` that returns a NEW vector where every element of \`v\` is multiplied by 2.

The input must not be modified. Example: input {1, 2, 3} → output {2, 4, 6}.

Test data: vector = {${p.values.join(", ")}} → answer {${p.values.map((x) => x * 2).join(", ")}}.`,
  harness: () => ({
    language: "cpp",
    entryFn: "doubleValues",
    args: "auto",
    argTypes: ["vector<int>"],
    returnType: "vector<int>",
    comparator: "array"
  }),
  scaffold: () => `std::vector<int> doubleValues(const std::vector<int>& v) {
    // TODO: return a new vector with every element doubled
    return {};
}`,
  reference: () => `std::vector<int> doubleValues(const std::vector<int>& v) {
    std::vector<int> result;
    result.reserve(v.size());
    for (int x : v) result.push_back(x * 2);
    return result;
}`,
  testCases: (_l, _c, p) => [
    { input: [[]], expected: [], description: "empty" },
    { input: [[1, 2, 3]], expected: [2, 4, 6], description: "basic" },
    { input: [p.values], expected: p.values.map((x) => x * 2), description: "parameterized" },
    { input: [[-5, 0, 5]], expected: [-10, 0, 10], description: "negatives and zero" }
  ],
  explanation: () =>
    "Build a new vector with push_back (reserve avoids reallocations). The input parameter is const&, so it cannot be modified — returning a fresh vector is the only option, which matches how pure functions should behave.",
  hints: () => [
    { threshold: 2, text: "Create an empty std::vector<int> result and push x * 2 for each element." },
    { threshold: 4, text: "Do not modify v — it is a const reference; build and return a new vector instead." }
  ],
  mistakePattern: () => "type_error"
};

const cppCountVowels: CodingArchetype = {
  id: "cpp_count_vowels",
  languages: ["cpp"],
  difficulty: 2,
  title: (_c, p) => `Count vowels in "${p.s}"`,
  prompt: (_c, p) =>
    `Write a function \`int countVowels(const std::string& s)\` that returns the number of vowel characters (a, e, i, o, u — both cases) in the string.

Non-alphabetic characters are ignored. Example: \`countVowels("hello")\` returns 2.

Test string: "${p.s}" → answer ${[...p.s].filter((c) => VOWELS.includes(c)).length}.`,
  harness: () => ({
    language: "cpp",
    entryFn: "countVowels",
    args: "auto",
    argTypes: ["string"],
    returnType: "int",
    comparator: "exact"
  }),
  scaffold: () => `int countVowels(const std::string& s) {
    // TODO: return the number of vowels (a, e, i, o, u, upper or lower case)
    return 0;
}`,
  reference: () => `int countVowels(const std::string& s) {
    const std::string vowels = "aeiouAEIOU";
    int count = 0;
    for (char c : s) {
        if (vowels.find(c) != std::string::npos) count++;
    }
    return count;
}`,
  testCases: (_l, _c, p) => [
    { input: [""], expected: 0, description: "empty" },
    { input: ["hello"], expected: 2, description: "basic" },
    { input: ["AEIOU"], expected: 5, description: "uppercase" },
    { input: [p.s], expected: [...p.s].filter((c) => VOWELS.includes(c)).length, description: "parameterized" },
    { input: ["bcdfg"], expected: 0, description: "no vowels" },
    { input: ["a e i o u"], expected: 5, description: "vowels with spaces" }
  ],
  explanation: () =>
    "Check membership of each character against a string containing all ten vowels (upper and lower). find() returning std::string::npos means 'not found'. Iterating characters is O(n) — optimal for this problem.",
  hints: () => [
    { threshold: 2, text: "Keep a constant string of all vowels including both cases: \"aeiouAEIOU\"." },
    { threshold: 4, text: "For each character, check if it appears in the vowels string with find() != std::string::npos." }
  ],
  mistakePattern: () => "boundary_check"
};

const cppFirstRepeat: CodingArchetype = {
  id: "cpp_first_repeat",
  languages: ["cpp"],
  difficulty: 3,
  title: (_c, p) => `First repeated value (vector of ${p.values.length})`,
  prompt: (_c, p) =>
    `Write a function \`int firstRepeat(const std::vector<int>& v)\` that returns the FIRST value which appears more than once in the vector (the one with the earliest second occurrence). If no value repeats, return -1.

Example: {3, 1, 3, 2, 1} → 3 appears twice first, so return 3. Note: {1, 2, 3, 2, 1} → the value 2 gets its second occurrence earlier than 1, so return 2.

Test data: vector = {${p.values.join(", ")}} → answer ${firstRepeatAnswer(p.values)}.`,
  harness: () => ({
    language: "cpp",
    entryFn: "firstRepeat",
    args: "auto",
    argTypes: ["vector<int>"],
    returnType: "int",
    comparator: "exact"
  }),
  scaffold: () => `int firstRepeat(const std::vector<int>& v) {
    // TODO: return the first repeated value, or -1 if none
    return -1;
}`,
  reference: () => `int firstRepeat(const std::vector<int>& v) {
    for (size_t i = 0; i < v.size(); i++) {
        for (size_t j = 0; j < i; j++) {
            if (v[j] == v[i]) return v[i];
        }
    }
    return -1;
}`,
  testCases: (_l, _c, p) => [
    { input: [[]], expected: -1, description: "empty" },
    { input: [[1, 2, 3]], expected: -1, description: "all unique" },
    { input: [[3, 1, 3, 2, 1]], expected: 3, description: "classic case" },
    { input: [[1, 2, 3, 2, 1]], expected: 2, description: "earlier second occurrence wins" },
    { input: [p.values], expected: firstRepeatAnswer(p.values), description: "parameterized" },
    { input: [[7, 7]], expected: 7, description: "pair" }
  ],
  explanation: () =>
    "Scan from left to right; for each position i, check whether v[i] already appeared earlier (indices < i). The first i where that holds yields the answer — this is the earliest second occurrence by construction. The nested loop is O(n²), which is fine for small inputs; a hash set would make it O(n) — recognizing that tradeoff is part of the exercise.",
  hints: () => [
    { threshold: 2, text: "For each position i, look back at all positions before it and compare values." },
    { threshold: 4, text: "The first position i where v[i] equals some earlier v[j] is your answer — 'first repeated' means earliest second occurrence." },
    { threshold: 6, text: "Return -1 only after scanning everything without finding a repeat." }
  ],
  mistakePattern: () => "logic_error"
};

function firstRepeatAnswer(values: number[]): number {
  const seen = new Set<number>();
  for (const v of values) {
    if (seen.has(v)) return v;
    seen.add(v);
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/* Python archetypes                                                   */
/* ------------------------------------------------------------------ */

const pySumRange: CodingArchetype = {
  id: "py_sum_range",
  languages: ["python"],
  difficulty: 1,
  title: (_c, p) => `Sum of integers from ${p.n - 5} to ${p.n + 5}`,
  prompt: (_c, p) =>
    `Write a function \`sum_range(a, b)\` that returns the sum of every integer from \`a\` to \`b\` inclusive.

\`sum_range(1, 4)\` returns \`10\` (1+2+3+4). If \`a\` is greater than \`b\`, return \`0\`.

Test with a=${p.n - 5}, b=${p.n + 5}: the answer is ${((p.n - 5 + p.n + 5) * 11) / 2}.`,
  harness: () => ({ language: "python", entryFn: "sum_range", args: "auto", comparator: "exact" }),
  scaffold: () => `def sum_range(a, b):
    # TODO: return the sum of all integers in [a, b], or 0 if a > b
    return 0`,
  reference: () => `def sum_range(a, b):
    if a > b:
        return 0
    return sum(range(a, b + 1))`,
  testCases: (_l, _c, p) => [
    { input: [1, 4], expected: 10, description: "basic 1..4" },
    { input: [p.n - 5, p.n + 5], expected: ((p.n - 5 + p.n + 5) * 11) / 2, description: "parameterized range" },
    { input: [5, 1], expected: 0, description: "a > b returns 0" },
    { input: [-3, 3], expected: 0, description: "symmetric negative" },
    { input: [0, 0], expected: 0, description: "single zero" },
    { input: [-7, -2], expected: -27, description: "negative range" }
  ],
  explanation: () =>
    "`range(a, b + 1)` produces every integer in the inclusive interval and `sum` adds them. The guard clause returns 0 for an empty range. Python ints never overflow, so large ranges are safe.",
  hints: () => [
    { threshold: 2, text: "Use the built-in range() and sum()." },
    { threshold: 4, text: "Handle a > b first — that is an empty range, so return 0." }
  ],
  mistakePattern: () => "off_by_one"
};

const pyListMax: CodingArchetype = {
  id: "py_list_max",
  languages: ["python"],
  difficulty: 1,
  title: (_c, p) => `Largest element in a list (size ${p.values.length})`,
  prompt: (_c, p) =>
    `Write a function \`list_max(v)\` that returns the largest value in the list.

The list is **never empty** in the test cases. Do not use the built-in \`max\` — write the loop yourself.

Test data: list = ${JSON.stringify(p.values)} → answer ${Math.max(...p.values)}.`,
  harness: () => ({ language: "python", entryFn: "list_max", args: "auto", comparator: "exact" }),
  scaffold: () => `def list_max(v):
    # TODO: return the maximum value in v (v is never empty, no built-in max)
    return 0`,
  reference: () => `def list_max(v):
    best = v[0]
    for x in v[1:]:
        if x > best:
            best = x
    return best`,
  testCases: (_l, _c, p) => [
    { input: [[5]], expected: 5, description: "single element" },
    { input: [[-1, -7, -3]], expected: -1, description: "all negative" },
    { input: [p.values], expected: Math.max(...p.values), description: "parameterized" },
    { input: [[10, 20, 30, 40, 50]], expected: 50, description: "sorted" },
    { input: [[7, 3, 7, 3, 7]], expected: 7, description: "duplicates" }
  ],
  explanation: () =>
    "Seed the best value with the first element (safe since the list is never empty) and scan the rest, updating whenever a larger value appears. One O(n) pass — every element must be inspected, so this is optimal.",
  hints: () => [
    { threshold: 2, text: "Start with best = v[0] — not 0 or -infinity, which breaks on all-negative lists." },
    { threshold: 4, text: "Loop over the remaining elements with for x in v[1:]: and update best when x > best." }
  ],
  mistakePattern: () => "uninitialized"
};

const pyCountEven: CodingArchetype = {
  id: "py_count_even",
  languages: ["python"],
  difficulty: 1,
  title: (_c, p) => `Count even numbers (list of ${p.values.length})`,
  prompt: (_c, p) =>
    `Write a function \`count_even(v)\` that returns how many values in the list are even (divisible by 2).

Test data: list = ${JSON.stringify(p.values)} → answer ${p.values.filter((x) => x % 2 === 0).length}.`,
  harness: () => ({ language: "python", entryFn: "count_even", args: "auto", comparator: "exact" }),
  scaffold: () => `def count_even(v):
    # TODO: return the count of even numbers in v
    return 0`,
  reference: () => `def count_even(v):
    return sum(1 for x in v if x % 2 == 0)`,
  testCases: (_l, _c, p) => [
    { input: [[]], expected: 0, description: "empty list" },
    { input: [[2, 4, 6]], expected: 3, description: "all even" },
    { input: [[1, 3, 5]], expected: 0, description: "all odd" },
    { input: [p.values], expected: p.values.filter((x) => x % 2 === 0).length, description: "parameterized" },
    { input: [[-2, -3, 0, 4]], expected: 3, description: "negatives and zero" }
  ],
  explanation: () =>
    "A generator expression over the list tests each value with x % 2 == 0 and sum() counts the matches. Zero is even; negative evens also satisfy the test.",
  hints: () => [
    { threshold: 2, text: "Use a generator expression: sum(1 for x in v if condition)." },
    { threshold: 4, text: "The even condition is x % 2 == 0 — it works for negatives and zero." }
  ],
  mistakePattern: () => "wrong_operator"
};

const pyDoubleValues: CodingArchetype = {
  id: "py_double_values",
  languages: ["python"],
  difficulty: 1,
  title: (_c, p) => `Double every element (list of ${p.values.length})`,
  prompt: (_c, p) =>
    `Write a function \`double_values(v)\` that returns a NEW list where every element of \`v\` is multiplied by 2. The input must not be modified.

Example: [1, 2, 3] → [2, 4, 6].

Test data: list = ${JSON.stringify(p.values)} → answer ${JSON.stringify(p.values.map((x) => x * 2))}.`,
  harness: () => ({ language: "python", entryFn: "double_values", args: "auto", comparator: "array" }),
  scaffold: () => `def double_values(v):
    # TODO: return a new list with every element doubled
    return []`,
  reference: () => `def double_values(v):
    return [x * 2 for x in v]`,
  testCases: (_l, _c, p) => [
    { input: [[]], expected: [], description: "empty" },
    { input: [[1, 2, 3]], expected: [2, 4, 6], description: "basic" },
    { input: [p.values], expected: p.values.map((x) => x * 2), description: "parameterized" },
    { input: [[-5, 0, 5]], expected: [-10, 0, 10], description: "negatives and zero" }
  ],
  explanation: () =>
    "A list comprehension builds a brand-new list without touching the input — this is the idiomatic Python way to transform a list and preserves the input's identity.",
  hints: () => [
    { threshold: 2, text: "Use a list comprehension: [x * 2 for x in v]." },
    { threshold: 4, text: "Build and return a new list — never mutate the input parameter." }
  ],
  mistakePattern: () => "type_error"
};

const pyCountVowels: CodingArchetype = {
  id: "py_count_vowels",
  languages: ["python"],
  difficulty: 1,
  title: (_c, p) => `Count vowels in "${p.s}"`,
  prompt: (_c, p) =>
    `Write a function \`count_vowels(s)\` that returns the number of vowel characters (a, e, i, o, u — both cases) in the string.

\`count_vowels("hello")\` returns 2.

Test string: "${p.s}" → answer ${[...p.s].filter((c) => VOWELS.includes(c)).length}.`,
  harness: () => ({ language: "python", entryFn: "count_vowels", args: "auto", comparator: "exact" }),
  scaffold: () => `def count_vowels(s):
    # TODO: return the number of vowels (a, e, i, o, u, upper or lower case)
    return 0`,
  reference: () => `def count_vowels(s):
    return sum(1 for c in s if c in "aeiouAEIOU")`,
  testCases: (_l, _c, p) => [
    { input: [""], expected: 0, description: "empty" },
    { input: ["hello"], expected: 2, description: "basic" },
    { input: ["AEIOU"], expected: 5, description: "uppercase" },
    { input: [p.s], expected: [...p.s].filter((c) => VOWELS.includes(c)).length, description: "parameterized" },
    { input: ["bcdfg"], expected: 0, description: "no vowels" },
    { input: ["a e i o u"], expected: 5, description: "vowels with spaces" }
  ],
  explanation: () =>
    "Membership testing with `c in \"aeiouAEIOU\"` is the clearest way to check vowels; sum() counts the True results. Iterating characters is O(n) — optimal.",
  hints: () => [
    { threshold: 2, text: "Membership: c in \"aeiouAEIOU\"." },
    { threshold: 4, text: "Combine with a generator: sum(1 for c in s if c in vowels)." }
  ],
  mistakePattern: () => "boundary_check"
};

const pyMostFrequent: CodingArchetype = {
  id: "py_most_frequent",
  languages: ["python"],
  difficulty: 2,
  title: (_c, p) => `Most frequent word (${p.words.length} words)`,
  prompt: (_c, p) =>
    `Write a function \`most_frequent(words)\` that returns the word that appears most often in the list. If there is a tie, return the word that appears first among the tied words (earliest position in the list).

Example: ["a", "b", "a"] → "a".

Test data: ${JSON.stringify(p.words)} → answer ${mostFrequentWord(p.words)}.`,
  harness: () => ({ language: "python", entryFn: "most_frequent", args: "auto", comparator: "exact" }),
  scaffold: () => `def most_frequent(words):
    # TODO: return the most frequent word; ties go to the earliest occurrence
    return ""`,
  reference: () => `def most_frequent(words):
    counts = {}
    best = None
    best_count = -1
    for w in words:
        counts[w] = counts.get(w, 0) + 1
        if counts[w] > best_count:
            best = w
            best_count = counts[w]
    return best`,
  testCases: (_l, _c, p) => [
    { input: [["a"]], expected: "a", description: "single" },
    { input: [["a", "b", "a"]], expected: "a", description: "basic" },
    { input: [p.words], expected: mostFrequentWord(p.words), description: "parameterized" },
    { input: [["x", "y", "x", "y", "z"]], expected: "x", description: "tie -> earliest" },
    { input: [["same", "same", "same"]], expected: "same", description: "all same" }
  ],
  explanation: () =>
    "A dict counts occurrences; iterating left to right, the moment a word reaches a new maximum it becomes the best — and because ties never exceed the current best (only > triggers an update), the earliest tied word wins. This is exactly how frequency tables work in real systems (log analysis, metrics, votes).",
  hints: () => [
    { threshold: 2, text: "Count occurrences with a dict: counts[w] = counts.get(w, 0) + 1." },
    { threshold: 4, text: "Track best and best_count; update only when counts[w] > best_count so ties keep the earliest word." }
  ],
  mistakePattern: () => "logic_error"
};

function mostFrequentWord(words: string[]): string {
  const counts = new Map<string, number>();
  let best = "";
  let bestCount = -1;
  for (const w of words) {
    counts.set(w, (counts.get(w) ?? 0) + 1);
    const c = counts.get(w)!;
    if (c > bestCount) {
      best = w;
      bestCount = c;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Parameter generation + selection                                    */
/* ------------------------------------------------------------------ */

const WORD_BANK = [
  "alpha", "beta", "gamma", "delta", "echo", "foxtrot", "hotel", "india",
  "juliet", "kilo", "lima", "mike", "november", "oscar", "papa", "quebec",
  "romeo", "sierra", "tango", "uniform", "victor", "whiskey", "xray", "zulu"
];

export function generateParams(ctx: GenContext): ArchetypeParams {
  const rng = mulberry32(ctx.seed);
  const n = 3 + Math.floor(rng() * 18);
  const values = randValues(rng, 5 + Math.floor(rng() * 6), -12, 25);
  const words = Array.from(
    { length: 6 + Math.floor(rng() * 5) },
    () => WORD_BANK[Math.floor(rng() * WORD_BANK.length)]!
  );
  const s = WORD_BANK.slice(0, 4 + Math.floor(rng() * 3)).join("");
  return { n, values, words, s };
}

export const ARCHETYPES: CodingArchetype[] = [
  cppSumRange,
  cppMaxElement,
  cppCountEven,
  cppDoubleValues,
  cppCountVowels,
  cppFirstRepeat,
  pySumRange,
  pyListMax,
  pyCountEven,
  pyDoubleValues,
  pyCountVowels,
  pyMostFrequent
];


/* ------------------------------------------------------------------ */
/* Multi-language archetypes (rust / c / bash / js)                    */
/* ------------------------------------------------------------------ */

function mlValue(v: unknown): string {
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(mlValue).join(" ");
  return String(v);
}

const genericSum: CodingArchetype = {
  id: "gen_sum_range",
  languages: ["rust", "c", "bash", "js"],
  difficulty: 1,
  title: (_c, p) => `Sum all integers from ${p.n} down to 0`,
  prompt: (_c, p) => `Write a function \`sum_down_to(n)\` that returns the sum of all integers from \`n\` down to \`0\` inclusive (n >= 0). Example: \`sum_down_to(3)\` = 3 + 2 + 1 + 0 = 6.`,
  harness: (l) => ({
    language: l as ExecutorLanguage,
    entryFn: "sum_down_to",
    args: "auto",
    argTypes: ["long long"],
    returnType: "long long",
    comparator: "exact"
  }),
  scaffold: (l) =>
    l === "rust"
      ? "fn sum_down_to(n: i64) -> i64 {\n    // TODO\n    0\n}"
      : l === "c"
        ? "long long sum_down_to(long long n) {\n    // TODO\n    return 0;\n}"
        : l === "js"
          ? "module.exports = function sum_down_to(n) {\n  // TODO\n  return 0;\n};"
          : "sum_down_to() {\n  local n=$1\n  echo 0\n}",
  reference: (l) =>
    l === "rust"
      ? "fn sum_down_to(n: i64) -> i64 {\n    (0..=n).sum()\n}"
      : l === "c"
        ? "long long sum_down_to(long long n) {\n    return n * (n + 1) / 2;\n}"
        : l === "js"
          ? "module.exports = function sum_down_to(n) {\n  let s = 0;\n  for (let i = 0; i <= n; i++) s += i;\n  return s;\n};"
          : "sum_down_to() {\n  local n=$1 s=0 i=0\n  while [ $i -le $n ]; do s=$((s + i)); i=$((i + 1)); done\n  echo $s\n}",
  testCases: (_l, _ctx, p) => [
    { input: [0], expected: 0, description: "zero" },
    { input: [1], expected: 1, description: "single" },
    { input: [p.n], expected: (p.n * (p.n + 1)) / 2, description: "parameterized" },
    { input: [10], expected: 55, description: "ten" },
    { input: [100], expected: 5050, description: "hundred" }
  ],
  explanation: () => "Use the closed-form n*(n+1)/2 for an O(1) solution, or a loop for O(n).",
  hints: () => [
    { threshold: 2, text: "There is a closed form: n*(n+1)/2." },
    { threshold: 4, text: "For n=3 the answer is 6. Check your loop bounds." }
  ],
  mistakePattern: () => "off_by_one"
};

const genericMax: CodingArchetype = {
  id: "gen_max_element",
  languages: ["rust", "c", "bash", "js"],
  difficulty: 2,
  title: (_c, p) => `Largest of [${p.values.slice(0, 4).join(", ")}...]`,
  prompt: (_c, p) => `Write \`max_element\` that takes a list of integers and returns the largest one. Example: max([3, 7, 2]) = 7.`,
  harness: (l) => ({
    language: l as ExecutorLanguage,
    entryFn: "max_element",
    args: "auto",
    argTypes: ["vector<long long>"],
    returnType: "long long",
    comparator: "exact"
  }),
  scaffold: (l) =>
    l === "rust"
      ? "fn max_element(v: Vec<i64>) -> i64 {\n    // TODO\n    0\n}"
      : l === "c"
        ? "long long max_element(ll_vec v) {\n    // TODO\n    return 0;\n}"
        : l === "js"
          ? "module.exports = function max_element(v) {\n  // TODO\n  return 0;\n};"
          : "max_element() {\n  local best=$1; shift\n  for x in \"$@\"; do [ $x -gt $best ] && best=$x; done\n  echo $best\n}",
  reference: (l) =>
    l === "rust"
      ? "fn max_element(v: Vec<i64>) -> i64 {\n    v.into_iter().max().unwrap_or(0)\n}"
      : l === "c"
        ? "long long max_element(ll_vec v) {\n    long long best = v.size ? v.data[0] : 0;\n    for (size_t k = 1; k < v.size; k++) if (v.data[k] > best) best = v.data[k];\n    return best;\n}"
        : l === "js"
          ? "module.exports = function max_element(v) {\n  return Math.max(...v);\n};"
          : "max_element() {\n  local best=$1; shift\n  for x in \"$@\"; do [ $x -gt $best ] && best=$x; done\n  echo $best\n}",
  testCases: (_l, _ctx, p) => [
    { input: [[p.values[0]]], expected: p.values[0], description: "single" },
    { input: [p.values.slice(0, 5)], expected: Math.max(...p.values.slice(0, 5)), description: "parameterized" },
    { input: [[5, 5, 5]], expected: 5, description: "ties" },
    { input: [[-1, -9, -3]], expected: -1, description: "negatives" },
    { input: [[1, 2, 3, 4, 5]], expected: 5, description: "ascending" }
  ],
  explanation: () => "Scan once keeping the current best: O(n) time, O(1) space.",
  hints: () => [
    { threshold: 2, text: "Keep a running best and update it as you scan." },
    { threshold: 4, text: "Initialize best with the FIRST element, not 0." }
  ],
  mistakePattern: () => "null_deref"
};

const genericCountVowels: CodingArchetype = {
  id: "gen_count_vowels",
  languages: ["rust", "c", "bash", "js"],
  difficulty: 2,
  title: (_c, p) => `Count vowels in "${p.s}"`,
  prompt: (_c, p) => `Write \`count_vowels\` that returns how many of a, e, i, o, u (either case) appear in the string. Example: count_vowels("hello") = 2.`,
  harness: (l) => ({
    language: l as ExecutorLanguage,
    entryFn: "count_vowels",
    args: "auto",
    argTypes: ["string"],
    returnType: "long long",
    comparator: "exact"
  }),
  scaffold: (l) =>
    l === "rust"
      ? "fn count_vowels(s: String) -> i64 {\n    // TODO\n    0\n}"
      : l === "c"
        ? "long long count_vowels(char* s) {\n    // TODO\n    return 0;\n}"
        : l === "js"
          ? "module.exports = function count_vowels(s) {\n  // TODO\n  return 0;\n};"
          : "count_vowels() {\n  echo 0\n}",
  reference: (l) =>
    l === "rust"
      ? "fn count_vowels(s: String) -> i64 {\n    s.chars().filter(|c| \"aeiouAEIOU\".contains(*c)).count() as i64\n}"
      : l === "c"
        ? "long long count_vowels(char* s) {\n    long long c = 0;\n    for (size_t k = 0; s[k]; k++) if (strchr(\"aeiouAEIOU\", s[k])) c++;\n    return c;\n}"
        : l === "js"
          ? "module.exports = function count_vowels(s) {\n  return (s.match(/[aeiou]/gi) || []).length;\n};"
          : "count_vowels() {\n  local s=$1\n  echo -n \"$s\" | tr -cd 'aeiouAEIOU' | wc -c\n}",
  testCases: (_l, _ctx, p) => [
    { input: [""], expected: 0, description: "empty" },
    { input: ["hello"], expected: 2, description: "basic" },
    { input: ["AEIOU"], expected: 5, description: "uppercase" },
    { input: [p.s], expected: [...p.s].filter((c) => VOWELS.includes(c)).length, description: "parameterized" },
    { input: ["bcdfg"], expected: 0, description: "none" },
    { input: ["a e i o u"], expected: 5, description: "with spaces" }
  ],
  explanation: () => "Check each character against the vowel set; counting is O(n).",
  hints: () => [
    { threshold: 2, text: "Keep a set of all ten vowels: aeiouAEIOU." },
    { threshold: 4, text: "Iterate every character and count membership." }
  ],
  mistakePattern: () => "logic_error"
};

const genericDoubleValues: CodingArchetype = {
  id: "gen_double_values",
  languages: ["rust", "c", "bash", "js"],
  difficulty: 2,
  title: (_c, p) => `Double every value of [${p.values.slice(0, 4).join(", ")}...]`,
  prompt: (_c, p) => `Write \`double_values\` that returns a new list where every element is multiplied by 2. Example: double([1, 2, 3]) = [2, 4, 6].`,
  harness: (l) => ({
    language: l as ExecutorLanguage,
    entryFn: "double_values",
    args: "auto",
    argTypes: ["vector<long long>"],
    returnType: "vector<long long>",
    comparator: "array"
  }),
  scaffold: (l) =>
    l === "rust"
      ? "fn double_values(v: Vec<i64>) -> Vec<i64> {\n    // TODO\n    Vec::new()\n}"
      : l === "c"
        ? "ll_vec double_values(ll_vec v) {\n    // TODO\n    return (ll_vec){0, 0};\n}"
        : l === "js"
          ? "module.exports = function double_values(v) {\n  // TODO\n  return [];\n};"
          : "double_values() {\n  for x in \"$@\"; do echo $((x * 2)); done\n}",
  reference: (l) =>
    l === "rust"
      ? "fn double_values(v: Vec<i64>) -> Vec<i64> {\n    v.into_iter().map(|x| x * 2).collect()\n}"
      : l === "c"
        ? "ll_vec double_values(ll_vec v) {\n    ll_vec r = {0, 0}; r.data = malloc(v.size * sizeof(long long)); r.size = v.size;\n    for (size_t k = 0; k < v.size; k++) r.data[k] = v.data[k] * 2;\n    return r;\n}"
        : l === "js"
          ? "module.exports = function double_values(v) {\n  return v.map((x) => x * 2);\n};"
          : "double_values() {\n  for x in \"$@\"; do echo $((x * 2)); done\n}",
  testCases: (_l, _ctx, p) => [
    { input: [[0]], expected: [0], description: "zero" },
    { input: [p.values.slice(0, 5)], expected: p.values.slice(0, 5).map((x) => x * 2), description: "parameterized" },
    { input: [[1, 2, 3]], expected: [2, 4, 6], description: "basic" },
    { input: [[-2, 0, 2]], expected: [-4, 0, 4], description: "mixed" }
  ],
  explanation: () => "Map each element: result[i] = input[i] * 2.",
  hints: () => [
    { threshold: 2, text: "Build the result element by element." },
    { threshold: 4, text: "Preserve order and length." }
  ],
  mistakePattern: () => "logic_error"
};


/* ------------------------------------------------------------------ */
/* Assembly archetypes (x86-64, AT&T, integer scalars)                 */
/* ------------------------------------------------------------------ */

const asmTriple: CodingArchetype = {
  id: "asm_triple",
  languages: ["asm"],
  difficulty: 1,
  title: () => "Triple a number in assembly",
  prompt: () => "Write an x86-64 function `triple(n)` that returns n * 3. Use AT&T syntax: `.text`, `.globl triple`, `imulq $3, %rdi, %rax`, `ret`.",
  harness: (l) => ({ language: l as ExecutorLanguage, entryFn: "triple", args: "auto", argTypes: ["long long"], returnType: "long long", comparator: "exact" }),
  scaffold: () => `.text
.globl triple
triple:
  # TODO: return 3 * %rdi
  xorq %rax, %rax
  ret`,
  reference: () => `.text
.globl triple
triple:
  imulq $3, %rdi, %rax
  ret`,
  testCases: () => [
    { input: [0], expected: 0, description: "zero" },
    { input: [1], expected: 3, description: "one" },
    { input: [7], expected: 21, description: "seven" },
    { input: [-4], expected: -12, description: "negative" }
  ],
  explanation: () => "imulq with an immediate multiplies %rdi in place of the destination; the product lands in %rax which is the return register.",
  hints: () => [
    { threshold: 2, text: "imulq $3, %rdi, %rax multiplies %rdi by 3 into %rax." },
    { threshold: 4, text: "The result must end in %rax because that is the return register." }
  ],
  mistakePattern: () => "logic_error"
};

const asmAdd: CodingArchetype = {
  id: "asm_add",
  languages: ["asm"],
  difficulty: 1,
  title: () => "Add two numbers in assembly",
  prompt: () => "Write an x86-64 function `add_two(a, b)` that returns a + b. First arg arrives in %rdi, second in %rsi.",
  harness: (l) => ({ language: l as ExecutorLanguage, entryFn: "add_two", args: "auto", argTypes: ["long long", "long long"], returnType: "long long", comparator: "exact" }),
  scaffold: () => `.text
.globl add_two
add_two:
  # TODO: return %rdi + %rsi
  xorq %rax, %rax
  ret`,
  reference: () => `.text
.globl add_two
add_two:
  leaq (%rdi, %rsi), %rax
  ret`,
  testCases: () => [
    { input: [0, 0], expected: 0, description: "zeros" },
    { input: [2, 3], expected: 5, description: "basic" },
    { input: [-10, 25], expected: 15, description: "mixed" },
    { input: [100, 200], expected: 300, description: "large" }
  ],
  explanation: () => "leaq computes an address expression without a load, so it is a compact add for two registers.",
  hints: () => [
    { threshold: 2, text: "leaq (%rdi, %rsi), %rax computes rdi + rsi into rax." },
    { threshold: 4, text: "The first two arguments are in %rdi and %rsi per the SysV ABI." }
  ],
  mistakePattern: () => "logic_error"
};

const asmMax: CodingArchetype = {
  id: "asm_max",
  languages: ["asm"],
  difficulty: 2,
  title: () => "Maximum of two numbers in assembly",
  prompt: () => "Write an x86-64 function `max_two(a, b)` returning the larger of the two. Use cmp + cmovq.",
  harness: (l) => ({ language: l as ExecutorLanguage, entryFn: "max_two", args: "auto", argTypes: ["long long", "long long"], returnType: "long long", comparator: "exact" }),
  scaffold: () => `.text
.globl max_two
max_two:
  # TODO: return max(%rdi, %rsi)
  xorq %rax, %rax
  ret`,
  reference: () => `.text
.globl max_two
max_two:
  movq %rdi, %rax
  cmpq %rsi, %rdi
  cmovlq %rsi, %rax
  ret`,
  testCases: () => [
    { input: [1, 2], expected: 2, description: "second larger" },
    { input: [5, 3], expected: 5, description: "first larger" },
    { input: [7, 7], expected: 7, description: "equal" },
    { input: [-3, -1], expected: -1, description: "negatives" }
  ],
  explanation: () => "cmpq sets flags; cmovlq moves %rsi into %rax only when the first operand (%rdi) is less.",
  hints: () => [
    { threshold: 2, text: "cmpq %rsi, %rdi compares rdi against rsi." },
    { threshold: 4, text: "cmovlq %rsi, %rax copies rsi into rax when rdi < rsi." }
  ],
  mistakePattern: () => "logic_error"
};

const asmEven: CodingArchetype = {
  id: "asm_is_even",
  languages: ["asm"],
  difficulty: 2,
  title: () => "Is a number even? (assembly)",
  prompt: () => "Write an x86-64 function `is_even(n)` returning 1 when n is even and 0 otherwise. Check the low bit with testq/andq.",
  harness: (l) => ({ language: l as ExecutorLanguage, entryFn: "is_even", args: "auto", argTypes: ["long long"], returnType: "long long", comparator: "exact" }),
  scaffold: () => `.text
.globl is_even
is_even:
  # TODO: return 1 if %rdi is even else 0
  xorq %rax, %rax
  ret`,
  reference: () => `.text
.globl is_even
is_even:
  movq %rdi, %rax
  andq $1, %rax
  xorq $1, %rax
  ret`,
  testCases: () => [
    { input: [0], expected: 1, description: "zero" },
    { input: [4], expected: 1, description: "even" },
    { input: [3], expected: 0, description: "odd" },
    { input: [-2], expected: 1, description: "negative even" }
  ],
  explanation: () => "n & 1 is 1 for odd numbers; xorq $1 flips it so even yields 1.",
  hints: () => [
    { threshold: 2, text: "andq $1, %rax isolates the lowest bit." },
    { threshold: 4, text: "Flip the bit with xorq $1, %rax so even returns 1." }
  ],
  mistakePattern: () => "logic_error"
};

const asmSumLoop: CodingArchetype = {
  id: "asm_sum_loop",
  languages: ["asm"],
  difficulty: 2,
  title: () => "Sum 1..n in assembly",
  prompt: () => "Write an x86-64 function `sum_to(n)` returning 1 + 2 + ... + n (n >= 0; sum of empty range is 0). Use a loop with an accumulator in %rax and a counter in another register.",
  harness: (l) => ({ language: l as ExecutorLanguage, entryFn: "sum_to", args: "auto", argTypes: ["long long"], returnType: "long long", comparator: "exact" }),
  scaffold: () => `.text
.globl sum_to
sum_to:
  # TODO: return 1+2+...+%rdi
  xorq %rax, %rax
  ret`,
  reference: () => `.text
.globl sum_to
sum_to:
  xorq %rax, %rax        # sum
  movq $1, %rcx          # i = 1
.Lloop:
  cmpq %rdi, %rcx
  jg .Ldone
  addq %rcx, %rax
  incq %rcx
  jmp .Lloop
.Ldone:
  ret`,
  testCases: () => [
    { input: [0], expected: 0, description: "zero" },
    { input: [1], expected: 1, description: "one" },
    { input: [4], expected: 10, description: "four" },
    { input: [10], expected: 55, description: "ten" }
  ],
  explanation: () => "Accumulate i into %rax from 1 while i <= n; %rcx is a scratch counter, %rax the return register.",
  hints: () => [
    { threshold: 2, text: "Keep the sum in %rax and a counter in %rcx." },
    { threshold: 4, text: "Loop while counter <= n; add the counter, then increment it." }
  ],
  mistakePattern: () => "off_by_one"
};

/* ------------------------------------------------------------------ */
/* SQL archetypes (fixed schema + fixed expected rows)                 */
/* ------------------------------------------------------------------ */

const SQL_CUSTOMERS = `CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, city TEXT);
INSERT INTO customers (id, name, city) VALUES
  (1, 'Amy', 'Berlin'),
  (2, 'Bob', 'Paris'),
  (3, 'Zed', 'Berlin'),
  (4, 'Nora', 'London');`;

const SQL_ORDERS = `CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
INSERT INTO customers (id, name) VALUES (1, 'Amy'), (2, 'Bob'), (3, 'Zed');
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, amount INTEGER);
INSERT INTO orders (id, customer_id, amount) VALUES
  (1, 1, 120), (2, 1, 30), (3, 2, 200), (4, 3, 90), (5, 3, 70);`;

const sqlSelectOrder: CodingArchetype = {
  id: "sql_select_order",
  languages: ["sql"],
  difficulty: 1,
  title: () => "List all customers sorted by name",
  prompt: () => "Write a SQL query that returns the `name` of every customer in the `customers` table, sorted alphabetically (A to Z).",
  harness: (l) => ({ language: l as ExecutorLanguage, entryFn: "", args: "auto", argTypes: [], returnType: "sql_rows", comparator: "exact", schema: SQL_CUSTOMERS }),
  scaffold: () => `-- TODO: write your SELECT here`,
  reference: () => `SELECT name FROM customers ORDER BY name`,
  testCases: () => [
    { input: [], expected: [["Amy"], ["Bob"], ["Nora"], ["Zed"]], description: "all names" }
  ],
  explanation: () => "SELECT name FROM customers returns one column; ORDER BY name sorts alphabetically.",
  hints: () => [
    { threshold: 2, text: "SELECT the name column from customers." },
    { threshold: 4, text: "ORDER BY name sorts the result." }
  ],
  mistakePattern: () => "sql_missing_order"
};

const sqlWhereFilter: CodingArchetype = {
  id: "sql_where_filter",
  languages: ["sql"],
  difficulty: 1,
  title: () => "Customers from Berlin",
  prompt: () => "Write a SQL query that returns the `name` of customers whose `city` is 'Berlin', sorted by name.",
  harness: (l) => ({ language: l as ExecutorLanguage, entryFn: "", args: "auto", argTypes: [], returnType: "sql_rows", comparator: "exact", schema: SQL_CUSTOMERS }),
  scaffold: () => `-- TODO: write your SELECT here`,
  reference: () => `SELECT name FROM customers WHERE city = 'Berlin' ORDER BY name`,
  testCases: () => [
    { input: [], expected: [["Amy"], ["Zed"]], description: "Berlin only" }
  ],
  explanation: () => "WHERE city = 'Berlin' filters rows before selection; note single quotes around the string literal.",
  hints: () => [
    { threshold: 2, text: "Filter with WHERE city = 'Berlin'." },
    { threshold: 4, text: "String literals use single quotes in SQL." }
  ],
  mistakePattern: () => "sql_string_quotes"
};

const sqlAggregate: CodingArchetype = {
  id: "sql_aggregate_sum",
  languages: ["sql"],
  difficulty: 2,
  title: () => "Total amount of all orders",
  prompt: () => "Write a query returning the sum of all `amount` values in the `orders` table as a single row (column name is optional).",
  harness: (l) => ({ language: l as ExecutorLanguage, entryFn: "", args: "auto", argTypes: [], returnType: "sql_rows", comparator: "exact", schema: SQL_ORDERS }),
  scaffold: () => `-- TODO: write your SELECT here`,
  reference: () => `SELECT SUM(amount) FROM orders`,
  testCases: () => [
    { input: [], expected: [[510]], description: "total" }
  ],
  explanation: () => "SUM(amount) aggregates all rows into one scalar; 120+30+200+90+70 = 510.",
  hints: () => [
    { threshold: 2, text: "Use the SUM aggregate over the amount column." },
    { threshold: 4, text: "120 + 30 + 200 + 90 + 70 = 510." }
  ],
  mistakePattern: () => "sql_wrong_aggregate"
};

const sqlGroupBy: CodingArchetype = {
  id: "sql_group_by",
  languages: ["sql"],
  difficulty: 2,
  title: () => "Order count per customer",
  prompt: () => "Write a query returning two columns: `customer_id` and the number of orders for that customer, ordered by customer_id.",
  harness: (l) => ({ language: l as ExecutorLanguage, entryFn: "", args: "auto", argTypes: [], returnType: "sql_rows", comparator: "exact", schema: SQL_ORDERS }),
  scaffold: () => `-- TODO: write your SELECT here`,
  reference: () => `SELECT customer_id, COUNT(*) FROM orders GROUP BY customer_id ORDER BY customer_id`,
  testCases: () => [
    { input: [], expected: [[1, 2], [2, 1], [3, 2]], description: "counts" }
  ],
  explanation: () => "GROUP BY customer_id buckets rows; COUNT(*) counts each bucket. Amy has 2, Bob 1, Zed 2.",
  hints: () => [
    { threshold: 2, text: "GROUP BY customer_id and use COUNT(*)." },
    { threshold: 4, text: "ORDER BY customer_id gives 1, 2, 3." }
  ],
  mistakePattern: () => "sql_missing_group_by"
};

const sqlJoin: CodingArchetype = {
  id: "sql_join",
  languages: ["sql"],
  difficulty: 2,
  title: () => "Customer names with their orders",
  prompt: () => "Write a query returning `name` and `amount` for every order, joined from customers to orders, ordered by order id.",
  harness: (l) => ({ language: l as ExecutorLanguage, entryFn: "", args: "auto", argTypes: [], returnType: "sql_rows", comparator: "exact", schema: SQL_ORDERS }),
  scaffold: () => `-- TODO: write your SELECT here`,
  reference: () => `SELECT c.name, o.amount FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id`,
  testCases: () => [
    { input: [], expected: [["Amy", 120], ["Amy", 30], ["Bob", 200], ["Zed", 90], ["Zed", 70]], description: "joined rows" }
  ],
  explanation: () => "JOIN connects each order to its customer via customer_id = id; ORDER BY o.id preserves insertion order.",
  hints: () => [
    { threshold: 2, text: "JOIN customers ON customers.id = orders.customer_id." },
    { threshold: 4, text: "Select name from customers and amount from orders." }
  ],
  mistakePattern: () => "sql_wrong_join_key"
};

const sqlInsert: CodingArchetype = {
  id: "sql_insert",
  languages: ["sql"],
  difficulty: 2,
  title: () => "Add a new customer",
  prompt: () => "Write an INSERT statement that adds a customer named 'Nora' to the `customers` table (id and city may be omitted or NULL).",
  harness: (l) => ({ language: l as ExecutorLanguage, entryFn: "", args: "auto", argTypes: [], returnType: "sql_rows", comparator: "exact", schema: SQL_CUSTOMERS, verificationQuery: "SELECT COUNT(*) FROM customers" }),
  scaffold: () => `-- TODO: write your INSERT here`,
  reference: () => `INSERT INTO customers (name) VALUES ('Nora')`,
  testCases: () => [
    { input: [], expected: [[5]], description: "row count after insert" }
  ],
  explanation: () => "INSERT INTO customers (name) VALUES ('Nora') adds a row; the verification query counts 5 rows total.",
  hints: () => [
    { threshold: 2, text: "INSERT INTO customers (name) VALUES (...)." },
    { threshold: 4, text: "The table already has 4 rows; after the insert it must have 5." }
  ],
  mistakePattern: () => "sql_wrong_syntax"
};

const ASM_ARCHETYPES: CodingArchetype[] = [asmTriple, asmAdd, asmMax, asmEven, asmSumLoop];
const SQL_ARCHETYPES: CodingArchetype[] = [sqlSelectOrder, sqlWhereFilter, sqlAggregate, sqlGroupBy, sqlJoin, sqlInsert];
const ML_ARCHETYPES: CodingArchetype[] = [genericSum, genericMax, genericCountVowels, genericDoubleValues, ...ASM_ARCHETYPES, ...SQL_ARCHETYPES];
export function pickArchetype(ctx: GenContext): CodingArchetype | null {
  const candidates = [...ARCHETYPES, ...ML_ARCHETYPES].filter(
    (a) => a.languages.includes(ctx.languageKey) && Math.abs(a.difficulty - ctx.difficulty) <= 1
  );
  if (candidates.length === 0) return null;
  const rng = mulberry32(ctx.seed + 1);
  return candidates[Math.floor(rng() * candidates.length)] ?? null;
}

export function buggyVariant(archetype: CodingArchetype, language: string, ctx: GenContext): string | null {
  if (!archetype.buggyScaffold) return null;
  return archetype.buggyScaffold(language, ctx);
}