/**
 * Just-in-time content generation.
 *
 * Every generator first tries the AI provider with a structured contract;
 * on failure (no provider, invalid output, network error) it falls back to
 * deterministic TEMPLATE generation. All coding content is subsequently
 * validated by executing the reference solution in the sandbox before it is
 * ever shown to a learner (see validator.ts).
 *
 * When an orchestrator is provided via deps, generation routes through the
 * gateway for quota/rate-limit/circuit-breaker handling. Otherwise it falls
 * back to the direct provider for backward compatibility.
 */

import type { ContentPayload } from "@cpd/core";
import { structured, type ChatMessage, type AIProvider } from "./provider.js";
import type { OrchestratorImpl } from "./orchestrator.js";
import {
  contentPayloadSchema,
  type GeneratedAssessment,
  type GeneratedExercise,
  type GeneratedLesson,
  type GeneratedProject,
  type GeneratedRealWorld,
  type GenContext
} from "./content.js";
import { pickArchetype, generateParams } from "./templates/archetypes.js";

export interface GenerationDeps {
  orchestrator?: OrchestratorImpl;
  provider?: AIProvider;
}

/** Ask the AI for structured JSON, routing through the orchestrator when available. */
async function askAI<T>(
  schema: import("zod").ZodType<T>,
  messages: ChatMessage[],
  deps?: GenerationDeps,
): Promise<T | null> {
  if (deps?.orchestrator) {
    return deps.orchestrator.generateStructured(schema, messages);
  }
  if (deps?.provider?.configured) {
    const raw = await deps.provider.chat(messages, { jsonMode: true });
    const parsed = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    if (!result.success) {
      console.warn(`[ai] structured output failed validation: ${result.error.message.slice(0, 500)}`);
      return null;
    }
    return result.data;
  }
  return structured(schema, messages);
}

/** Fisher-Yates shuffle — mutates in place, returns the array. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

const SYSTEM = `You are the curriculum engine of a rigorous programming mentor. You generate high-quality teaching material for a single learner. Rules:
- Content must be correct, precise and free of ambiguity.
- Exercises must have exactly one correct answer.
- Reference solutions must compile and pass every test case (C++17/20, std only; Python 3, stdlib only).
- For C++: scaffold and referenceSolution contain ONLY function definitions — no #include, no main(). Include <bits/stdc++.h> is provided by the harness.
- Harness argTypes/returnType must be from: int, long long, double, string, bool, vector<int>, vector<long long>, vector<double>, vector<string>. Use comparator exact for scalars/strings, array/array_float for numeric arrays.
- Test case "input" is an ARRAY OF ARGUMENTS for the function.
- Hints are progressive: each hint is revealed only after N failed attempts (threshold).
- Lessons must teach WHY, include a mental model, common mistakes, real-world usage, and when NOT to use the concept.
- Respond with valid JSON only, matching the requested schema exactly.`;

function learnerLine(ctx: GenContext): string {
  return [
    `learnerLevel=${ctx.learner.level}`,
    `prerequisitesMastered=[${ctx.learner.prerequisitesMastered.join(", ")}]`,
    `recentMistakes=[${ctx.learner.recentMistakes.join(", ")}]`,
    `preferredDifficulty=${ctx.difficulty}`
  ].join("\n");
}

function nodeBlock(ctx: GenContext): string {
  return [
    `language=${ctx.languageKey}`,
    `nodeKey=${ctx.nodeKey}`,
    `label=${ctx.label}`,
    `definition=${ctx.definition}`,
    `applications=[${ctx.applications.join(", ")}]`,
    `misconceptions=[${ctx.misconceptions.join(", ")}]`,
    `estMinutes=${ctx.estMinutes}`
  ].join("\n");
}

function promptFor(kind: string, ctx: GenContext, extra: string): string {
  return `Generate a ${kind} for the learning objective below.\n\nOBJECTIVE\n${nodeBlock(ctx)}\n\nLEARNER\n${learnerLine(ctx)}\n\n${extra}\n\nRespond with valid JSON matching the schema.`;
}

/* ------------------------------------------------------------------ */
/* LESSON                                                              */
/* ------------------------------------------------------------------ */

export async function generateLesson(ctx: GenContext, deps?: GenerationDeps): Promise<GeneratedLesson> {
  const ai = await askAI(contentPayloadSchema, [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: promptFor(
        "lesson",
        ctx,
        `The lesson must contain 8-14 sections in this order: 1) the problem it solves, 2) mental model, 3) simple code example, 4) why it works, 5) common mistakes (calloutKind "common-mistake"), 6) real-world use (calloutKind "real-world"), 7) when NOT to use it, 8) recap. Sections: {"type":"markdown"|"code"|"callout","title":...,"content":...,"language":"${ctx.languageKey}","calloutKind":...}. Schema: {"kind":"LESSON","sections":[...]}`
      )
    }
  ], deps);

  if (ai?.kind === "LESSON") {
    return { title: `Understanding ${ctx.label}`, payload: ai, source: "AI_GENERATED" };
  }
  return templateLesson(ctx);
}

function templateLesson(ctx: GenContext): GeneratedLesson {
  const app = ctx.applications[0] ?? "systems that need correctness and performance";
  const mis = ctx.misconceptions[0] ?? "treating the concept as a rule to memorize rather than a mechanism to understand";
  const payload: Extract<ContentPayload, { kind: "LESSON" }> = {
    kind: "LESSON",
    sections: [
      {
        type: "markdown",
        title: "The problem it solves",
        content: `${ctx.label} exists because programs that skip it become hard to reason about, fragile, or slow. Without a solid grasp of ${ctx.label.toLowerCase()}, code that works by accident keeps breaking. In practice, ${ctx.definition}`
      },
      {
        type: "markdown",
        title: "Mental model",
        content: `Think of ${ctx.label.toLowerCase()} as a tool in your mental toolbox: a specific, reliable mechanism you reach for when the situation calls for it. The correct mental model is more valuable than memorized rules, because it lets you predict behavior in unfamiliar situations.`
      },
      {
        type: "code",
        title: "A minimal example",
        content: minimalExample(ctx),
        language: ctx.languageKey
      },
      {
        type: "markdown",
        title: "Why it works",
        content: `The mechanism works because it composes with the language's model of computation (values, control flow, and memory). Once you can predict the outcome of a small example, larger programs are just combinations of the same predictable steps.`
      },
      {
        type: "callout",
        title: "Common mistakes",
        calloutKind: "common-mistake",
        content: `The most common failure here is ${mis}. When you hit a bug related to ${ctx.label.toLowerCase()}, first check your mental model before changing code blindly.`
      },
      {
        type: "callout",
        title: "Where this appears in real software",
        calloutKind: "real-world",
        content: `Real-world example: ${app}. Professional codebases rely on this idea constantly — compilers, databases, game engines, and operating systems all build on it.`
      },
      {
        type: "markdown",
        title: "When NOT to use it",
        content: `Not every problem needs ${ctx.label.toLowerCase()}. If the situation can be expressed more simply without it, prefer the simpler form — clarity beats cleverness. Revisit this decision when the simpler form becomes painful.`
      },
      {
        type: "markdown",
        title: "What you just learned",
        content: `- What ${ctx.label.toLowerCase()} is and the problem it solves\n- A mental model to predict behavior\n- One minimal working example\n- The most common mistakes and the real-world places it shows up\n- When to avoid it`
      }
    ]
  };
  return { title: `Understanding ${ctx.label}`, payload, source: "TEMPLATE" };
}

function minimalExample(ctx: GenContext): string {
  const label = ctx.label;
  const key = ctx.languageKey;
  const desc = `replace with a tiny illustration of "${label.toLowerCase()}"`;
  const concept = JSON.stringify(label);
  if (key === "cpp") {
    return `#include <iostream>

int main() {
    // ${desc}
    std::cout << "concept: " << ${concept} << "\\n";
    return 0;
}`;
  }
  if (key === "rust") {
    return `fn main() {
    // ${desc}
    let concept = ${concept};
    println!("concept: {}", concept);
}`;
  }
  if (key === "c") {
    return `#include <stdio.h>

int main() {
    // ${desc}
    printf("concept: %s\\n", ${concept});
    return 0;
}`;
  }
  if (key === "bash") {
    return `#!/bin/bash
# ${desc}
concept="${concept}"
echo "concept: $concept"`;
  }
  if (key === "js") {
    return `// ${desc}
const concept = ${concept};
console.log("concept:", concept);`;
  }
  if (key === "sql") {
    return `-- ${desc}
SELECT ${concept} AS concept;`;
  }
  if (key === "asm") {
    return `; ${desc}
section .data
    concept db ${concept}, 0

section .text
    global _start
_start:
    ; write concept to stdout
    mov rax, 1
    mov rdi, 1
    mov rsi, concept
    mov rdx, 32
    syscall
    ; exit
    mov rax, 60
    xor rdi, rdi
    syscall`;
  }
  // python fallback
  return `# ${desc}
concept = ${concept}
print("concept:", concept)`;
}

/* ------------------------------------------------------------------ */
/* EXERCISE (coding / debugging)                                       */
/* ------------------------------------------------------------------ */

const EXERCISE_EXTRA =
  `Schema: {"kind":"CODING"|"DEBUGGING","hints":[{"threshold":2,"text":"..."}],"harness":{...},"testCases":[{"input":[args...],"expected":...,"description":"..."}],"scaffold":"...","referenceSolution":"...","explanationMd":"...","mistakePattern":"off_by_one|wrong_operator|null_deref|uninitialized|mem_leak|type_error|overflow|boundary_check|logic_error|complexity_error|misread_problem|syntax_error|wrong_signature","tags":["..."]}.
Test cases: 4-8, including edge cases (empty input, single element, negatives, large values, duplicates). Each: {"input":[args...],"expected":value,"description":"..."}. The problem must require reasoning about ${"{label}"} — it should NOT be solvable by ignoring the concept. Include a difficulty-${"{difficulty}"} problem.`;

export async function generateExercise(
  ctx: GenContext,
  kind: "CODING" | "DEBUGGING",
  deps?: GenerationDeps,
): Promise<GeneratedExercise> {
  const ai = await askAI(contentPayloadSchema, [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: promptFor(
        kind === "CODING" ? "coding exercise" : "debugging exercise (scaffold contains a subtle bug the learner must fix)",
        ctx,
        EXERCISE_EXTRA
      )
    }
  ], deps);
  if (ai && (ai.kind === "CODING" || ai.kind === "DEBUGGING")) {
    return {
      title: `Practice: ${ctx.label}`,
      payload: {
        kind: ai.kind,
        hints: ai.hints,
        harness: ai.harness,
        testCases: ai.testCases,
        scaffold: ai.scaffold,
        referenceSolution: ai.referenceSolution,
        explanationMd: ai.explanationMd,
        mistakePattern: ai.mistakePattern,
        tags: ai.tags
      },
      source: "AI_GENERATED"
    };
  }
  return templateExercise(ctx, kind);
}

function fallbackScaffold(ctx: GenContext): string {
  const label = ctx.label;
  const k = ctx.languageKey;
  if (k === "cpp") return `// ${label}\n// TODO: implement\n#include <vector>\nusing namespace std;\n\nvector<int> solution(vector<int> args) {\n    // implement\n    return {};\n}`;
  if (k === "rust") return `// ${label}\n// TODO: implement\n\nfn solution(args: Vec<i32>) -> Vec<i32> {\n    // implement\n    vec![]\n}`;
  if (k === "c") return `// ${label}\n// TODO: implement\n#include <stddef.h>\n\n// define function here`;
  if (k === "bash") return `#!/bin/bash\n# ${label}\n# TODO: implement\nsolution() {\n    echo "implement me"\n}`;
  if (k === "js") return `// ${label}\n// TODO: implement\nfunction solution(...args) {\n    // implement\n}`;
  if (k === "python") return `# ${label}\n# TODO: implement\ndef solution(*args):\n    pass`;
  if (k === "sql") return `-- ${label}\n-- TODO: implement\nSELECT 1;`;
  if (k === "asm") return `; ${label}\n; TODO: implement`;
  return `// ${label}\n// TODO: implement\nfunction solution() {}`;
}

function fallbackReference(ctx: GenContext): string {
  const label = ctx.label;
  const k = ctx.languageKey;
  if (k === "cpp") return `// ${label}\n#include <vector>\nusing namespace std;\n\nvector<int> solution(vector<int> args) {\n    return args;\n}`;
  if (k === "rust") return `// ${label}\n\nfn solution(args: Vec<i32>) -> Vec<i32> {\n    args\n}`;
  if (k === "c") return `// ${label}\n#include <stddef.h>`;
  if (k === "bash") return `#!/bin/bash\n# ${label}\nsolution() { echo "$@"; }`;
  if (k === "js") return `// ${label}\nfunction solution(...args) { return args; }`;
  if (k === "python") return `# ${label}\ndef solution(*args): return list(args)`;
  return `// ${label}\nfunction solution() {}`;
}

function templateExercise(ctx: GenContext, kind: "CODING" | "DEBUGGING"): GeneratedExercise {
  const archetype = pickArchetype(ctx);
  const params = generateParams(ctx);
  if (!archetype) {
    const payload: Extract<ContentPayload, { kind: "CODING" | "DEBUGGING" }> = {
      kind,
      hints: [{ threshold: 0, text: "Think about the problem step by step." }],
      harness: {
        language: ctx.languageKey,
        entryFn: "solution",
        args: [],
        comparator: "exact",
        timeoutMs: 10_000,
      },
      testCases: [{ input: "[]", expected: "[]" }],
      scaffold: fallbackScaffold(ctx),
      referenceSolution: fallbackReference(ctx),
      explanationMd: `This exercise covers ${ctx.label}.`,
      mistakePattern: "logic_error",
      tags: [ctx.nodeKey]
    };
    return { title: `Practice: ${ctx.label}`, payload, source: "TEMPLATE" };
  }
  const payload: Extract<ContentPayload, { kind: "CODING" | "DEBUGGING" }> = {
    kind,
    hints: archetype.hints(),
    harness: archetype.harness(ctx.languageKey, ctx),
    testCases: archetype.testCases(ctx.languageKey, ctx, params),
    scaffold: kind === "DEBUGGING" && archetype.buggyScaffold
      ? archetype.buggyScaffold(ctx.languageKey, ctx)
      : archetype.scaffold(ctx.languageKey, ctx),
    referenceSolution: archetype.reference(ctx.languageKey, ctx),
    explanationMd: archetype.explanation(ctx),
    mistakePattern: archetype.mistakePattern(),
    tags: [ctx.nodeKey]
  };
  const kindLabel = kind === "DEBUGGING" ? "Debugging task" : "Coding exercise";
  return { title: `${kindLabel}: ${archetype.title(ctx, params)}`, payload, source: "TEMPLATE" };
}

/* ------------------------------------------------------------------ */
/* CONCEPTUAL / TRACING / PREDICTION                                   */
/* ------------------------------------------------------------------ */

export async function generateConceptual(ctx: GenContext, deps?: GenerationDeps): Promise<GeneratedExercise> {
  const ai = await askAI(contentPayloadSchema, [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: promptFor(
        "multiple-choice conceptual question",
        ctx,
        `Schema: {"kind":"CONCEPTUAL","options":["A","B","C","D"],"answerIndex":0,"hints":[...],"explanationMd":"..."}. Exactly one correct option; distractors must be plausible but wrong (use common misconceptions).`
      )
    }
  ], deps);
  if (ai?.kind === "CONCEPTUAL") {
    return { title: `Check your understanding: ${ctx.label}`, payload: ai, source: "AI_GENERATED" };
  }
  return templateConceptual(ctx);
}

function templateConceptual(ctx: GenContext): GeneratedExercise {
  const trueStmt = ctx.definition.length > 60 ? ctx.definition : `${ctx.label} is a core mechanism with predictable behavior and real engineering value.`;
  const mis1 = ctx.misconceptions[0] ?? "it is just a syntax detail you memorize and never think about again";
  const mis2 = ctx.misconceptions[1] ?? "using it makes every program automatically correct and fast";
  const options = shuffle([trueStmt, mis1, mis2, "It only matters for interview questions, never for real code."]);
  const answerIndex = options.indexOf(trueStmt);
  const payload: Extract<ContentPayload, { kind: "CONCEPTUAL" }> = {
    kind: "CONCEPTUAL",
    options,
    answerIndex,
    hints: [],
    explanationMd: `The correct statement is the one that describes the actual mechanism: ${trueStmt}. The other options are the misconceptions learners typically bring to ${ctx.label.toLowerCase()}.`
  };
  return { title: `Understanding check: ${ctx.label}`, payload, source: "TEMPLATE" };
}

export async function generateTracing(ctx: GenContext, kind: "TRACING" | "PREDICTION", deps?: GenerationDeps): Promise<GeneratedExercise> {
  const ai = await askAI(contentPayloadSchema, [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: promptFor(
        kind === "TRACING" ? "code tracing task (learner predicts program output)" : "prediction task (learner predicts behavior/value)",
        ctx,
        `Schema: {"kind":"TRACING"|"PREDICTION","codeSnippet":"...","acceptedAnswers":["exact output text"],"explanationMd":"...","hints":[...]}. The snippet must involve ${"{label}"} and have exactly ONE output/behavior.`
      )
    }
  ], deps);
  if (ai && (ai.kind === "TRACING" || ai.kind === "PREDICTION")) {
    return { title: `Trace it: ${ctx.label}`, payload: ai, source: "AI_GENERATED" };
  }
  return templateTracing(ctx, kind);
}

function templateTracing(ctx: GenContext, kind: "TRACING" | "PREDICTION"): GeneratedExercise {
  const lang = ctx.languageKey;
  const loopSnippet =
    lang === "cpp"
      ? `int main() {\n    int total = 0;\n    for (int i = 1; i <= 4; i++) {\n        total += i * 2;\n    }\n    std::cout << total << std::endl;\n    return 0;\n}`
      : lang === "rust"
      ? `fn main() {\n    let mut total = 0;\n    for i in 1..=4 {\n        total += i * 2;\n    }\n    println!("{}", total);\n}`
      : lang === "c"
      ? `#include <stdio.h>\nint main() {\n    int total = 0;\n    for (int i = 1; i <= 4; i++) {\n        total += i * 2;\n    }\n    printf("%d\\n", total);\n    return 0;\n}`
      : lang === "js"
      ? `let total = 0;\nfor (let i = 1; i <= 4; i++) {\n    total += i * 2;\n}\nconsole.log(total);`
      : lang === "bash"
      ? `total=0\nfor i in 1 2 3 4; do\n    total=$((total + i * 2))\ndone\necho $total`
      : `total = 0\nfor i in range(1, 5):\n    total += i * 2\nprint(total)`;
  const payload: Extract<ContentPayload, { kind: "TRACING" | "PREDICTION" }> = {
    kind,
    codeSnippet: loopSnippet,
    acceptedAnswers: ["20"],
    explanationMd: `The loop runs for i = 1, 2, 3, 4 and adds i * 2 each time: 2 + 4 + 6 + 8 = 20. Tracing a loop step by step is the most reliable way to predict behavior — do it on paper before guessing.`,
    hints: [{ threshold: 2, text: "Write out each iteration: what is i, what is added, what is the running total?" }]
  };
  return { title: `Trace it: ${ctx.label}`, payload, source: "TEMPLATE" };
}

/* ------------------------------------------------------------------ */
/* ASSESSMENT                                                          */
/* ------------------------------------------------------------------ */

export async function generateAssessment(ctx: GenContext, deps?: GenerationDeps): Promise<GeneratedAssessment> {
  const ai = await askAI(contentPayloadSchema, [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: promptFor(
        "concept assessment",
        ctx,
        `Schema: {"kind":"ASSESSMENT","questions":[{"kind":"MCQ","prompt":"...","options":[...4],"answerIndex":n,"explanation":"...","points":1}],"passThreshold":0.7}. 4-6 questions mixing recall, application, and misconception traps. Exactly one correct answer per question.`
      )
    }
  ], deps);
  if (ai?.kind === "ASSESSMENT") {
    return { title: `Assessment: ${ctx.label}`, payload: ai, source: "AI_GENERATED" };
  }
  return templateAssessment(ctx);
}

function templateAssessment(ctx: GenContext): GeneratedAssessment {
  const trueStmt = ctx.definition.length > 60 ? ctx.definition : `${ctx.label} is a core mechanism with predictable behavior.`;
  const mis1 = ctx.misconceptions[0] ?? "it is purely a syntax detail";
  const mis2 = ctx.misconceptions[1] ?? "mastering it guarantees fast code everywhere";
  const app1 = ctx.applications[0] ?? "large production codebases";
  const app2 = ctx.applications[1] ?? ctx.applications[0] ?? "compilers and runtimes";

  const opts1 = shuffle([trueStmt, mis1, mis2, "A way to make code harder to review."]);
  const opts2 = shuffle([`${app1}`, `${app2}`, "Only in toy examples.", "Nowhere — it is purely academic."]);
  const opts3 = shuffle([mis1, "It has precise, predictable semantics.", "It composes with other language features.", "It requires care about edge cases."]);
  const opts4 = shuffle([
    `When a simpler construct expresses the same idea clearly (e.g., in ${app2}).`,
    "Never — it is always the best choice.",
    "When the code is performance-critical.",
    "When working with more than one function."
  ]);

  const payload: Extract<ContentPayload, { kind: "ASSESSMENT" }> = {
    kind: "ASSESSMENT",
    passThreshold: 0.7,
    questions: [
      {
        kind: "MCQ",
        prompt: `Which statement best describes ${ctx.label}?`,
        options: opts1,
        answerIndex: opts1.indexOf(trueStmt),
        explanation: `The definition of ${ctx.label} is: ${trueStmt}.`,
        points: 1
      },
      {
        kind: "MCQ",
        prompt: `Where does ${ctx.label} most commonly appear in real software?`,
        options: opts2,
        answerIndex: opts2.indexOf(`${app1}`),
        explanation: `${ctx.label} shows up in ${app1} — professional engineering depends on it daily.`,
        points: 1
      },
      {
        kind: "MCQ",
        prompt: `Which of the following is a common misconception about ${ctx.label}?`,
        options: opts3,
        answerIndex: opts3.indexOf(mis1),
        explanation: `${mis1} is exactly the misconception learners carry; the other options are true properties.`,
        points: 1
      },
      {
        kind: "MCQ",
        prompt: `When should you AVOID reaching for ${ctx.label}?`,
        options: opts4,
        answerIndex: opts4.indexOf(`When a simpler construct expresses the same idea clearly (e.g., in ${app2}).`),
        explanation: `Simplicity wins: if the simpler form is equally clear and correct, prefer it.`,
        points: 1
      }
    ]
  };
  return { title: `Assessment: ${ctx.label}`, payload, source: "TEMPLATE" };
}

/* ------------------------------------------------------------------ */
/* REAL-WORLD                                                          */
/* ------------------------------------------------------------------ */

export async function generateRealWorld(ctx: GenContext, deps?: GenerationDeps): Promise<GeneratedRealWorld> {
  const ai = await askAI(contentPayloadSchema, [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: promptFor(
        "real-world application reading + reflection",
        ctx,
        `Schema: {"kind":"REAL_WORLD","contextMd":"...","reflectionQuestions":["..."],"explanationMd":"..."}. contextMd explains 1-2 concrete real systems using ${"{label}"}; reflectionQuestions ask the learner to connect it to their own experience.`
      )
    }
  ], deps);
  if (ai?.kind === "REAL_WORLD") {
    return { title: `Real world: ${ctx.label}`, payload: ai, source: "AI_GENERATED" };
  }
  const app = ctx.applications[0] ?? "real systems";
  const payload: Extract<ContentPayload, { kind: "REAL_WORLD" }> = {
    kind: "REAL_WORLD",
    contextMd: `Where does ${ctx.label} actually matter? ${app}. Professional engineers rely on this every day — it is the difference between code that works on a laptop and code that survives in production.\n\nRead the connection, then answer the reflection questions in your own words. This is not a test — it is training your ability to recognize the concept in unfamiliar places.`,
    reflectionQuestions: [
      `In the system described, where exactly does ${ctx.label} appear, and what would break if it were removed?`,
      `Think of software you have used today. Where might ${ctx.label} be hiding in it?`
    ],
    explanationMd: `Recognizing a concept in real systems is a skill on its own. Revisit this activity when you meet unfamiliar code: ask "which concept from my training is doing work here?"`
  };
  return { title: `Real world: ${ctx.label}`, payload, source: "TEMPLATE" };
}

/* ------------------------------------------------------------------ */
/* PROJECT                                                             */
/* ------------------------------------------------------------------ */

export async function generateProject(ctx: GenContext, deps?: GenerationDeps): Promise<GeneratedProject> {
  const ai = await askAI(contentPayloadSchema, [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: promptFor(
        "small project brief",
        ctx,
        `Schema: {"kind":"PROJECT","briefMd":"...","requirements":["..."],"checklist":["..."],"rubric":[{"criterion":"...","maxPoints":10}],"estMinutesTotal":...}. The project must require COMBINING several previously learned concepts — not just ${"{label}"} in isolation. Realistic, buildable in the learner's time budget, no external libraries.`
      )
    }
  ], deps);
  if (ai?.kind === "PROJECT") {
    return { title: `Project: ${ctx.label}`, payload: ai, source: "AI_GENERATED" };
  }
  return templateProject(ctx);
}

function templateProject(ctx: GenContext): GeneratedProject {
  const payload: Extract<ContentPayload, { kind: "PROJECT" }> = {
    kind: "PROJECT",
    briefMd: `Build a small command-line tool that demonstrates ${ctx.label} in a realistic setting. You choose the exact tool (a tiny analyzer, a formatter, a simulator) as long as it satisfies the requirements below.\n\nWrite it from scratch in ${ctx.languageKey === "cpp" ? "C++ (one .cpp file, std only, no external libraries)" : "Python (stdlib only)"}. Structure the code so the roles of each concept are obvious: a reviewer (or your future self) should be able to point at each requirement and find the code implementing it.`,
    requirements: [
      `Use ${ctx.label} as a central mechanism — the tool's behavior depends on it.`,
      "Accept input from the command line or a small file; produce readable output.",
      "Handle at least one error case gracefully instead of crashing.",
      "Organize the code into at least two functions/units with clear responsibilities.",
      "Add a short README-style comment header explaining what the tool does and how it uses the concept."
    ],
    checklist: [
      "I can run the tool with realistic input.",
      "The tool behaves correctly on the happy path.",
      "At least one failure case is handled (missing input, bad data, empty file).",
      "The concept under study is genuinely load-bearing, not decorative.",
      "I can explain each requirement in my own words."
    ],
    rubric: [
      { criterion: "Correctness on happy path", maxPoints: 10 },
      { criterion: "The target concept is genuinely applied", maxPoints: 10 },
      { criterion: "Error handling", maxPoints: 5 },
      { criterion: "Code structure and clarity", maxPoints: 5 }
    ],
    estMinutesTotal: ctx.estMinutes
  };
  return { title: `Project: ${ctx.label}`, payload, source: "TEMPLATE" };
}