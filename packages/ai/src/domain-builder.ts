/**
 * AI Domain Builder.
 *
 * The domain model (knowledge graph) is constructed and expanded by the AI
 * from a language-level seed. The tutor requests expansion when the learner
 * outgrows the modeled frontier. Each new node is structured knowledge
 * (definition, prerequisites, related, applications, misconceptions) that the
 * tutor can reason over.
 */

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { domainEdges, domainNodes, type DB } from "@cpd/core";
import { structured } from "./provider.js";
import { mulberry32 } from "./templates/archetypes.js";

export const newNodeSchema = z.object({
  nodeKey: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  definition: z.string().min(20),
  difficulty: z.number().int().min(1).max(5),
  estMinutes: z.number().int().min(10).max(240),
  prerequisites: z.array(z.string()),
  related: z.array(z.string()),
  applications: z.array(z.string().min(3)).min(1),
  misconceptions: z.array(z.string().min(3)).min(1)
});

export type NewNode = z.infer<typeof newNodeSchema>;

export interface DomainExpansion {
  nodes: NewNode[];
  source: "AI" | "TEMPLATE";
}

/* ------------------------------------------------------------------ */
/* Deterministic frontier templates (fallback)                         */
/* ------------------------------------------------------------------ */

interface FrontierNode extends NewNode {
  /** nodeKeys that must already exist in the graph to unlock this node */
  requires: string[];
  /** For domain-scoped nodes: language-track level (number of mastered
   *  language nodes) required to unlock this node. Domains are their own
   *  track; entry into them is gated on how far the learner has built
   *  their language foundation. */
  requiresLanguageLevel?: number;
}

const CPP_FRONTIER: FrontierNode[] = [
  {
    nodeKey: "variables",
    label: "Variables",
    definition: "Named storage with a type: declaration, initialization (not assignment), scope, and lifetime of values in C++.",
    difficulty: 1,
    estMinutes: 40,
    prerequisites: [],
    related: ["types", "operators", "control-flow"],
    applications: ["every program stores state in variables", "config parsers hold settings in typed variables", "game engines track player state in variables"],
    misconceptions: ["declaration and initialization are the same thing", "an uninitialized variable has a predictable value", "const variables can be changed at runtime"],
    requires: []
  },
  {
    nodeKey: "types",
    label: "Types",
    definition: "The C++ type system: integer widths, floating point, bool/char, narrowing conversions, overflow as undefined behavior, auto deduction.",
    difficulty: 1,
    estMinutes: 50,
    prerequisites: ["variables"],
    related: ["operators", "functions"],
    applications: ["protocol code must pick exact-width integer types", "databases choose column types by range and precision", "overflow bugs caused real-world failures (Ariane 5, Y2K-era accounting)"],
    misconceptions: ["int is always 32-bit everywhere", "unsigned means 'non-negative safety'", "narrowing conversions are safe"],
    requires: ["variables"]
  },
  {
    nodeKey: "operators",
    label: "Operators",
    definition: "Arithmetic, comparison, logical and assignment operators in C++, including precedence, short-circuit evaluation, and integer division semantics.",
    difficulty: 1,
    estMinutes: 40,
    prerequisites: ["variables", "types"],
    related: ["control-flow"],
    applications: ["financial code depends on exact division and rounding semantics", "compilers evaluate precedence when parsing expressions", "game physics uses operator combinations constantly"],
    misconceptions: ["integer division rounds to nearest", "== and = are interchangeable", "precedence always follows left-to-right"],
    requires: ["variables", "types"]
  },
  {
    nodeKey: "control-flow",
    label: "Control Flow",
    definition: "Branching and iteration in C++: if/else, switch, while/for/do-while, break/continue, and choosing iteration over recursion.",
    difficulty: 1,
    estMinutes: 45,
    prerequisites: ["variables", "operators"],
    related: ["functions", "dynamic-arrays"],
    applications: ["servers loop over request queues", "UI event loops are control flow at scale", "validators branch on input shapes"],
    misconceptions: ["switch falls through only with goto", "for and while are always interchangeable", "break exits all nested loops"],
    requires: ["variables", "operators"]
  },
  {
    nodeKey: "functions",
    label: "Functions",
    definition: "Declarations vs definitions, pass-by-value semantics, return by value, default arguments, overloads, and the call-stack model of execution.",
    difficulty: 1,
    estMinutes: 45,
    prerequisites: ["control-flow", "types"],
    related: ["stack-heap", "references"],
    applications: ["every C++ library is a function API surface", "operating systems expose syscalls as functions", "recursion uses the call stack exactly as functions define it"],
    misconceptions: ["arguments are passed by reference by default", "the function name matters to the compiler", "returning a local variable is always wrong"],
    requires: ["control-flow", "types"]
  },
  {
    nodeKey: "stack-heap",
    label: "Stack vs Heap",
    definition: "The two memory regions: stack frames for function-local data with automatic lifetime, heap for dynamic data with manual/owned lifetime; cost and fragmentation tradeoffs.",
    difficulty: 2,
    estMinutes: 55,
    prerequisites: ["functions"],
    related: ["pointers", "dynamic-memory"],
    applications: ["recursive parsers grow the stack", "string buffers and containers allocate on the heap", "embedding code avoids heap allocation in hot paths"],
    misconceptions: ["the stack is 'fast' because it is in cache only", "heap allocation is free", "stack variables die at the end of main"],
    requires: ["functions"]
  },
  {
    nodeKey: "pointers",
    label: "Pointers",
    definition: "Addresses as values: address-of and dereference operators, null, dangling pointers, pointer arithmetic on arrays, and the undefined behavior they invite.",
    difficulty: 2,
    estMinutes: 55,
    prerequisites: ["stack-heap"],
    related: ["references", "dynamic-memory", "dynamic-arrays"],
    applications: ["linked structures and buffers in C APIs", "iterating raw memory in systems code", "function pointers power callbacks in C libraries"],
    misconceptions: ["pointers and arrays are identical", "dereferencing a dangling pointer is safe if it looks fine", "null checks make every pointer safe"],
    requires: ["stack-heap"]
  },
  {
    nodeKey: "references",
    label: "References",
    definition: "Aliases that must bind to an existing object: why they exist (operators, pass-by-ref, range-for), const-ref efficiency, and lifetime rules.",
    difficulty: 2,
    estMinutes: 45,
    prerequisites: ["pointers", "functions"],
    related: ["raii", "dynamic-memory"],
    applications: ["operator overloads return references", "avoiding copies of large objects in hot loops", "range-based for loops bind references"],
    misconceptions: ["references are pointers with nicer syntax", "a reference can be rebound", "const ref extends the lifetime of a temporary to anywhere"],
    requires: ["pointers", "functions"]
  },
  {
    nodeKey: "dynamic-memory",
    label: "Dynamic Memory",
    definition: "new/delete and new[]/delete[]: allocation lifetime, leaks, double free, and the ownership question of who is responsible for cleanup.",
    difficulty: 2,
    estMinutes: 50,
    prerequisites: ["pointers", "stack-heap"],
    related: ["raii", "dynamic-arrays"],
    applications: ["containers allocate and free on resize", "object pools manage chunks of dynamic memory", "leaks in long-running services cause OOM kills"],
    misconceptions: ["the OS reclaims leaks so they do not matter", "delete and delete[] are interchangeable", "double free is caught by the language"],
    requires: ["pointers", "stack-heap"]
  },
  {
    nodeKey: "raii",
    label: "RAII",
    definition: "Resource Acquisition Is Initialization: bind resource lifetime to object lifetime via constructors/destructors; unique_ptr, shared_ptr, and exception safety.",
    difficulty: 3,
    estMinutes: 60,
    prerequisites: ["dynamic-memory", "references"],
    related: ["classes", "encapsulation"],
    applications: ["std::fstream closes files automatically", "std::lock_guard releases mutexes on every exit path", "smart pointers own heap objects"],
    misconceptions: ["RAII means 'using smart pointers'", "destructors are only for memory", "RAII and exceptions are unrelated"],
    requires: ["dynamic-memory", "references"]
  },
  {
    nodeKey: "dynamic-arrays",
    label: "Dynamic Arrays",
    definition: "Contiguous resizable storage (std::vector): capacity vs size, growth strategy, amortized O(1) push_back, and why cache locality matters.",
    difficulty: 2,
    estMinutes: 50,
    prerequisites: ["control-flow", "dynamic-memory"],
    related: ["binary-search", "sorting-basics"],
    applications: ["every container-heavy C++ program", "graph adjacency lists use vectors of vectors", "message buffers grow amortized"],
    misconceptions: ["push_back is always O(1) worst case", "vector stores elements contiguously only sometimes", "resize and reserve do the same thing"],
    requires: ["control-flow", "dynamic-memory"]
  },
  {
    nodeKey: "big-o",
    label: "Big O",
    definition: "Asymptotic complexity: growth classes, why we ignore constants, worst vs average case, and measuring real programs.",
    difficulty: 2,
    estMinutes: 40,
    prerequisites: ["functions", "dynamic-arrays"],
    related: ["binary-search", "sorting-basics", "merge-sort"],
    applications: ["database query planners reason in Big O", "choosing algorithms for billion-row pipelines", "API rate limiters estimate request complexity"],
    misconceptions: ["O(1) means instant", "Big O is about actual seconds", "lower Big O is always better in practice"],
    requires: ["functions", "dynamic-arrays"]
  },
  {
    nodeKey: "binary-search",
    label: "Binary Search",
    definition: "Halving a sorted range to find an element in O(log n): invariant maintenance, boundary handling, and the off-by-one traps.",
    difficulty: 3,
    estMinutes: 50,
    prerequisites: ["big-o", "dynamic-arrays"],
    related: ["merge-sort"],
    applications: ["database index lookups", "std::lower_bound in the standard library", "range checks in spell-checkers and dictionaries"],
    misconceptions: ["binary search works on unsorted data", "mid = (lo + hi) / 2 cannot overflow", "all binary searches share one template"],
    requires: ["big-o", "dynamic-arrays"]
  },
  {
    nodeKey: "sorting-basics",
    label: "Sorting Basics",
    definition: "Selection sort and insertion sort: the O(n²) algorithms, their properties (stable, in-place, adaptive), and why they still appear in practice.",
    difficulty: 2,
    estMinutes: 45,
    prerequisites: ["dynamic-arrays", "big-o"],
    related: ["merge-sort", "binary-search"],
    applications: ["insertion sort for tiny arrays in production sorters", "nearly-sorted data in event streams", "teaching the swap-based mental model"],
    misconceptions: ["sorting is always O(n log n)", "selection sort is stable", "in-place means constant extra memory is impossible"],
    requires: ["dynamic-arrays", "big-o"]
  },
  {
    nodeKey: "merge-sort",
    label: "Merge Sort",
    definition: "Divide-and-conquer sorting in O(n log n): recursive splitting, merging two sorted halves, and stable external-friendly behavior.",
    difficulty: 3,
    estMinutes: 55,
    prerequisites: ["sorting-basics", "recursion-intro"],
    related: ["binary-search", "big-o"],
    applications: ["tim-sort in Python/Rust uses merge ideas", "external sorting of files larger than RAM", "counting inversions for ranking systems"],
    misconceptions: ["merge sort sorts in place", "its O(n log n) is always faster than insertion sort", "recursion depth is free"],
    requires: ["sorting-basics", "recursion-intro"]
  },
  {
    nodeKey: "recursion-intro",
    label: "Recursion",
    definition: "Functions that call themselves: base case and progress, the call stack, and when recursion beats iteration (trees, divide-and-conquer).",
    difficulty: 2,
    estMinutes: 45,
    prerequisites: ["functions", "control-flow"],
    related: ["merge-sort", "binary-search"],
    applications: ["parsing expressions", "traversing trees in compilers", "divide-and-conquer algorithms"],
    misconceptions: ["recursion is always slower", "recursion and iteration are identical tools", "every recursive call copies the input"],
    requires: ["functions", "control-flow"]
  },
  {
    nodeKey: "classes",
    label: "Classes",
    definition: "User-defined types: struct vs class, member functions, constructors and member-init order, this pointer, and object lifetime.",
    difficulty: 2,
    estMinutes: 50,
    prerequisites: ["functions", "references"],
    related: ["encapsulation", "raii"],
    applications: ["models in game engines", "request/response types in servers", "value types in libraries"],
    misconceptions: ["a class is a template for objects only", "member initialization order follows the constructor body", "struct means no methods"],
    requires: ["functions", "references"]
  },
  {
    nodeKey: "encapsulation",
    label: "Encapsulation",
    definition: "Access control and invariants: private members, const correctness, and why interfaces protect state from corruption.",
    difficulty: 2,
    estMinutes: 40,
    prerequisites: ["classes"],
    related: ["inheritance"],
    applications: ["bank account objects that reject negative balances", "thread-safe classes hide locks behind methods", "API design hides implementation details"],
    misconceptions: ["private means secure against attack", "getters/setters ARE encapsulation", "const correctness is optional style"],
    requires: ["classes"]
  },
  {
    nodeKey: "inheritance",
    label: "Inheritance",
    definition: "is-a relationships, base/derived classes, slicing, virtual functions, and why runtime polymorphism exists — plus when composition beats inheritance.",
    difficulty: 3,
    estMinutes: 55,
    prerequisites: ["classes", "encapsulation"],
    related: ["templates-intro"],
    applications: ["interface hierarchies in GUI frameworks", "polymorphic strategies in game AI", "CRTP and template patterns in libraries"],
    misconceptions: ["inheritance is always the right reuse tool", "slicing only matters in edge cases", "virtual means slow so avoid it always"],
    requires: ["classes", "encapsulation"]
  },
  {
    nodeKey: "templates-intro",
    label: "Templates",
    definition: "Compile-time genericity: function and class templates, type deduction, and why STL containers are templates.",
    difficulty: 3,
    estMinutes: 50,
    prerequisites: ["functions", "classes"],
    related: ["dynamic-arrays", "inheritance"],
    applications: ["std::vector<int> and std::vector<std::string> are the same template", "generic algorithms in libraries", "zero-cost abstraction in game engines"],
    misconceptions: ["templates are runtime polymorphism", "template code is compiled once", "templates and macros are the same"],
    requires: ["functions", "classes"]
  },
  {
    nodeKey: "concurrency-intro",
    label: "Concurrency",
    definition: "Threads, races, and synchronization: why data races are undefined behavior, mutexes/locks, and the fundamental difficulty of parallel correctness.",
    difficulty: 4,
    estMinutes: 60,
    prerequisites: ["functions", "raii"],
    related: ["dynamic-arrays"],
    applications: ["web servers handle thousands of connections concurrently", "databases use locks and MVCC", "game engines parallelize rendering"],
    misconceptions: ["threads make everything faster automatically", "a race is just a slow bug", "atomic variables make all code thread-safe"],
    requires: ["functions", "raii"]
  },
  {
    nodeKey: "networking-intro",
    label: "Networking Basics",
    definition: "Sockets, TCP connections, request/response semantics, and the lifecycle of data between two programs.",
    difficulty: 4,
    estMinutes: 60,
    prerequisites: ["functions", "dynamic-arrays"],
    related: ["concurrency-intro"],
    applications: ["every web request travels over sockets", "message brokers move data between services", "game networking predicts and syncs state"],
    misconceptions: ["TCP is message-oriented", "localhost has no failure modes", "closing a socket always flushes data"],
    requires: ["functions", "dynamic-arrays"]
  }
];

const PYTHON_FRONTIER: FrontierNode[] = [
  {
    nodeKey: "py-variables-types",
    label: "Variables and Types",
    definition: "Python's dynamic typing: names bind to objects, everything is an object, int/float/str/bool/None, and identity vs equality.",
    difficulty: 1,
    estMinutes: 40,
    prerequisites: [],
    related: ["py-control-flow", "py-lists", "py-dicts"],
    applications: ["scripting and automation rely on dynamic types", "data pipelines mix numbers, strings and None freely", "JSON maps directly onto Python types"],
    misconceptions: ["variables store values like boxes", "immutable types cannot be rebound", "== and is are interchangeable"],
    requires: []
  },
  {
    nodeKey: "py-control-flow",
    label: "Control Flow",
    definition: "if/elif/else, for over iterables, range, enumerate, while, break/continue — Python's readable iteration model.",
    difficulty: 1,
    estMinutes: 40,
    prerequisites: ["py-variables-types"],
    related: ["py-lists", "py-functions"],
    applications: ["processing files line by line", "CLI tools branch on user input", "looping over API responses"],
    misconceptions: ["for loops need indices", "range is a list", "while is always better than for"],
    requires: ["py-variables-types"]
  },
  {
    nodeKey: "py-functions",
    label: "Functions",
    definition: "def, return, default arguments, keyword arguments, docstrings, and functions as first-class values.",
    difficulty: 1,
    estMinutes: 40,
    prerequisites: ["py-control-flow"],
    related: ["py-lists", "py-dicts"],
    applications: ["library APIs are functions", "decorators wrap functions", "callbacks in event-driven code"],
    misconceptions: ["default arguments are evaluated per call", "functions and methods are identical", "return is optional everywhere"],
    requires: ["py-control-flow"]
  },
  {
    nodeKey: "py-lists",
    label: "Lists",
    definition: "Mutable ordered sequences: indexing, slicing, appending, comprehensions, and the difference from tuples.",
    difficulty: 1,
    estMinutes: 45,
    prerequisites: ["py-variables-types", "py-functions"],
    related: ["py-dicts"],
    applications: ["collecting results in pipelines", "queueing tasks in scripts", "comprehensions transform data concisely"],
    misconceptions: ["slicing creates references", "list and tuple are interchangeable", "a list is a good set"],
    requires: ["py-variables-types", "py-functions"]
  },
  {
    nodeKey: "py-dicts",
    label: "Dictionaries",
    definition: "Hash-based key-value mapping: insertion, lookup, iteration, .get defaults, and what makes keys hashable.",
    difficulty: 2,
    estMinutes: 45,
    prerequisites: ["py-variables-types", "py-lists"],
    related: ["py-functions"],
    applications: ["JSON objects are dicts", "caches and memoization", "counting frequencies in log analysis"],
    misconceptions: ["dicts preserve no order", "any object can be a key", "dict lookup is always instant"],
    requires: ["py-variables-types", "py-lists"]
  },
  {
    nodeKey: "py-strings",
    label: "Strings",
    definition: "Immutable text: methods, formatting, slicing, membership, and why immutability is a feature.",
    difficulty: 1,
    estMinutes: 35,
    prerequisites: ["py-variables-types"],
    related: ["py-lists"],
    applications: ["parsing log lines", "generating reports", "sanitizing user input"],
    misconceptions: ["strings are mutable", "f-strings are slow", "+ concatenation is the best way"],
    requires: ["py-variables-types"]
  },
  {
    nodeKey: "py-exceptions",
    label: "Exceptions",
    definition: "try/except/finally, exception hierarchy, and when to let errors propagate instead of swallowing them.",
    difficulty: 2,
    estMinutes: 40,
    prerequisites: ["py-functions", "py-control-flow"],
    related: ["py-functions"],
    applications: ["robust CLI tools catch expected errors", "HTTP clients retry on timeout", "resource cleanup in finally blocks"],
    misconceptions: ["bare except is fine", "exceptions are slow so avoid them entirely", "every function needs try/except"],
    requires: ["py-functions", "py-control-flow"]
  },
  {
    nodeKey: "py-classes",
    label: "Classes",
    definition: "Classes and instances, __init__, methods, dunder methods, and when classes beat plain dicts.",
    difficulty: 2,
    estMinutes: 45,
    prerequisites: ["py-functions", "py-dicts"],
    related: ["py-exceptions"],
    applications: ["models in Django/FastAPI", "custom exceptions with attributes", "stateful objects in simulations"],
    misconceptions: ["__init__ is a constructor", "self is a keyword", "classes are always better than dicts"],
    requires: ["py-functions", "py-dicts"]
  }
];


/* ------------------------------------------------------------------ */
/* Rust / C / Bash / JS frontiers                                      */
/* ------------------------------------------------------------------ */

const RUST_FRONTIER: FrontierNode[] = [
  { nodeKey: "rust-variables", label: "Variables and Bindings", definition: "Rust bindings with let, immutability by default, shadowing, and type inference for scalar values.", difficulty: 1, estMinutes: 40, prerequisites: [], related: ["rust-types", "rust-functions"], applications: ["CLI tools store config in bindings", "game state kept in mutable bindings"], misconceptions: ["let makes values constant forever", "mut is the same as reassignment in other languages", "shadowing changes the original variable"], requires: [] },
  { nodeKey: "rust-types", label: "Scalar Types", definition: "i32/i64, f64, bool, char; numeric literals, overflow behavior, and type annotations.", difficulty: 1, estMinutes: 45, prerequisites: ["rust-variables"], related: ["rust-control-flow"], applications: ["protocols pick exact integer widths", "scientific code chooses float precision"], misconceptions: ["usize is always 64-bit", "integer overflow is silent wrapping everywhere", "char holds multiple bytes"], requires: ["rust-variables"] },
  { nodeKey: "rust-control-flow", label: "Control Flow", definition: "if/else as expressions, loop/while/for over ranges and iterators, break/continue.", difficulty: 1, estMinutes: 40, prerequisites: ["rust-types"], related: ["rust-functions", "rust-strings"], applications: ["summing ranges in algorithms", "retry loops in network clients"], misconceptions: ["if always needs parentheses", "for i in 0..n includes n", "loop can never return a value"], requires: ["rust-types"] },
  { nodeKey: "rust-functions", label: "Functions", definition: "fn syntax, parameters, return values, expressions vs statements, and early returns.", difficulty: 1, estMinutes: 45, prerequisites: ["rust-control-flow"], related: ["rust-strings", "rust-slices"], applications: ["reusable math helpers", "pure functions in parsers"], misconceptions: ["return is required for the last expression", "semicolons are optional", "arguments are always copied"], requires: ["rust-control-flow"] },
  { nodeKey: "rust-strings", label: "Strings", definition: "String vs &str, UTF-8 chars, string literals, and common string operations like contains and filtering.", difficulty: 2, estMinutes: 50, prerequisites: ["rust-functions"], related: ["rust-slices"], applications: ["text processing in CLIs", "parsing user input"], misconceptions: ["indexing a String gives a character", "String is a Vec<char>", "to_string and & are interchangeable"], requires: ["rust-functions"] },
  { nodeKey: "rust-slices", label: "Vectors and Slices", definition: "Vec<T>, iteration, indexing, slicing &[T], and common iterator combinators like map and max.", difficulty: 2, estMinutes: 50, prerequisites: ["rust-functions"], related: ["rust-strings"], applications: ["collecting command output", "statistics over datasets"], misconceptions: ["vectors are fixed size", "iterating consumes the vector", "max on an empty vector is 0"], requires: ["rust-functions"] }
];

const C_FRONTIER: FrontierNode[] = [
  { nodeKey: "c-variables", label: "Variables and Types", definition: "C declarations, int/long/char/float widths, and the importance of initialization.", difficulty: 1, estMinutes: 40, prerequisites: [], related: ["c-control-flow", "c-functions"], applications: ["embedded firmware stores sensor values", "protocol code picks exact-width types"], misconceptions: ["int is always 32-bit", "uninitialized variables are zero", "char is always signed"], requires: [] },
  { nodeKey: "c-control-flow", label: "Control Flow", definition: "if/else, for/while loops, break/continue, and integer comparison semantics.", difficulty: 1, estMinutes: 40, prerequisites: ["c-variables"], related: ["c-functions"], applications: ["summing arrays in kernels", "retry loops in drivers"], misconceptions: ["assignment in conditions is a mistake", "== compares values by identity", "unsigned comparisons are intuitive"], requires: ["c-variables"] },
  { nodeKey: "c-functions", label: "Functions", definition: "Function prototypes, parameters by value, return values, and header declarations.", difficulty: 1, estMinutes: 45, prerequisites: ["c-control-flow"], related: ["c-strings"], applications: ["library APIs expose functions", "test harnesses call functions"], misconceptions: ["prototypes are optional", "arrays are passed by value", "missing return is undefined everywhere"], requires: ["c-control-flow"] },
  { nodeKey: "c-strings", label: "Strings", definition: "char arrays, NUL termination, string.h helpers, and why strings are not a built-in type.", difficulty: 2, estMinutes: 50, prerequisites: ["c-functions"], related: ["c-arrays"], applications: ["parsing text input", "building CLI output"], misconceptions: ["a string literal is mutable", "strlen counts the NUL", "strcpy is always safe"], requires: ["c-functions"] },
  { nodeKey: "c-arrays", label: "Arrays and Vectors", definition: "C arrays, struct wrappers with size+data for dynamic arrays, and safe iteration by index.", difficulty: 2, estMinutes: 50, prerequisites: ["c-functions"], related: ["c-strings"], applications: ["sensor data buffers", "image processing rows"], misconceptions: ["arrays know their own length", "arrays can be returned by value", "out-of-bounds is an error, not UB"], requires: ["c-functions"] }
];

const BASH_FRONTIER: FrontierNode[] = [
  { nodeKey: "bash-variables", label: "Variables and Parameters", definition: "Bash variables, $1-style positional parameters, quoting, and why spaces matter.", difficulty: 1, estMinutes: 40, prerequisites: [], related: ["bash-strings", "bash-functions"], applications: ["script config values", "passing arguments to helper scripts"], misconceptions: ["spaces around = are fine", "single and double quotes are identical", "variables are typed"], requires: [] },
  { nodeKey: "bash-strings", label: "Strings and Text", definition: "Quoting rules, echo/printf, tr/sed/grep pipelines, and text filtering with exit codes.", difficulty: 1, estMinutes: 45, prerequisites: ["bash-variables"], related: ["bash-control-flow"], applications: ["log analysis", "text processing pipelines"], misconceptions: ["grep exit 1 is an error", "pipes run left to right only", "echo is safe for all input"], requires: ["bash-variables"] },
  { nodeKey: "bash-control-flow", label: "Control Flow", definition: "if/[ ] tests, for loops over words, while loops, arithmetic with $(( )).", difficulty: 1, estMinutes: 40, prerequisites: ["bash-strings"], related: ["bash-functions"], applications: ["loop over files", "retry logic in deploy scripts"], misconceptions: ["[ ] is syntax, not a command", "for x in $(ls) is robust", "integer math works on floats"], requires: ["bash-strings"] },
  { nodeKey: "bash-functions", label: "Functions", definition: "function syntax, positional params inside functions, local variables, and stdout as return channel.", difficulty: 1, estMinutes: 45, prerequisites: ["bash-control-flow"], related: ["bash-arrays"], applications: ["reusable script helpers", "modular CI scripts"], misconceptions: ["functions return values like other languages", "local is optional", "function args differ from script args"], requires: ["bash-control-flow"] },
  { nodeKey: "bash-arrays", label: "Arrays and Positional Args", definition: "Iterating \"$@\" (all positional args), word splitting rules, and treating script arguments as a list.", difficulty: 2, estMinutes: 50, prerequisites: ["bash-functions"], related: ["bash-strings"], applications: ["processing many files", "argument-driven scripts"], misconceptions: ["unquoted \"$@\" is safe", "arrays and strings are interchangeable", "empty args disappear silently"], requires: ["bash-functions"] }
];

const JS_FRONTIER: FrontierNode[] = [
  { nodeKey: "js-variables", label: "Variables and Types", definition: "let/const, number/string/boolean, typeof, and dynamic typing rules.", difficulty: 1, estMinutes: 40, prerequisites: [], related: ["js-control-flow", "js-functions"], applications: ["web app state", "CLI tool options"], misconceptions: ["var and let behave identically", "NaN equals NaN", "const means immutable value"], requires: [] },
  { nodeKey: "js-control-flow", label: "Control Flow", definition: "if/else, for/of and classic for loops, while, and truthiness rules.", difficulty: 1, estMinutes: 40, prerequisites: ["js-variables"], related: ["js-functions"], applications: ["looping over results", "validation checks"], misconceptions: ["0 and '' are falsy but not equal", "== is fine for comparisons", "for..of indexes like C"], requires: ["js-variables"] },
  { nodeKey: "js-functions", label: "Functions", definition: "function declarations, arrow functions, parameters, return values, and module.exports.", difficulty: 1, estMinutes: 45, prerequisites: ["js-control-flow"], related: ["js-strings", "js-arrays"], applications: ["exporting helpers from modules", "event handlers"], misconceptions: ["arrows and function are identical", "missing return yields undefined", "parameters are validated"], requires: ["js-control-flow"] },
  { nodeKey: "js-strings", label: "Strings", definition: "String methods, regex matching, template literals, and character access.", difficulty: 2, estMinutes: 45, prerequisites: ["js-functions"], related: ["js-arrays"], applications: ["input sanitization", "text search in UIs"], misconceptions: ["s[0] and s.at(0) are identical", "regex literal /g resets state", "string methods mutate"], requires: ["js-functions"] },
  { nodeKey: "js-arrays", label: "Arrays and Methods", definition: "Array methods map/filter/reduce, spread, Math.max, and immutability patterns.", difficulty: 2, estMinutes: 45, prerequisites: ["js-functions"], related: ["js-strings"], applications: ["transforming API responses", "data pipelines"], misconceptions: ["map mutates the original", "Math.max(...[]) is -Infinity not error", "filter removes holes safely"], requires: ["js-functions"] }
];


/* ------------------------------------------------------------------ */
/* Assembly / SQL frontiers                                            */
/* ------------------------------------------------------------------ */

const ASM_FRONTIER: FrontierNode[] = [
  { nodeKey: "asm-registers", label: "Registers and ABI", definition: "x86-64 general-purpose registers (rax/rdi/rsi/rcx/rdx/r8-r9), %rip, and the SysV argument/return convention.", difficulty: 1, estMinutes: 40, prerequisites: [], related: ["asm-data-movement", "asm-arithmetic"], applications: ["reading disassembly", "debugging crashes with register state"], misconceptions: ["rax is a general 'answer' register only", "registers are all interchangeable", "rdi/rsi are scratch registers"], requires: [] },
  { nodeKey: "asm-data-movement", label: "Data Movement", definition: "movq/leaq forms, immediate constants, register-to-register copies, and why leaq is not a load.", difficulty: 1, estMinutes: 40, prerequisites: ["asm-registers"], related: ["asm-arithmetic"], applications: ["argument shuffling in wrappers", "understanding compiler output"], misconceptions: ["leaq reads memory", "movq between registers copies through memory", "immediates can be 64-bit freely"], requires: ["asm-registers"] },
  { nodeKey: "asm-arithmetic", label: "Arithmetic Instructions", definition: "addq/subq/imulq/andq/xorq/incq, two-operand forms, and result placement in %rax.", difficulty: 1, estMinutes: 45, prerequisites: ["asm-data-movement"], related: ["asm-control-flow"], applications: ["tight numeric kernels", "implementing small math helpers"], misconceptions: ["the destination is always rax", "mulq and imulq are identical", "addq with immediate writes flags you ignore"], requires: ["asm-data-movement"] },
  { nodeKey: "asm-control-flow", label: "Branches and Flags", definition: "cmpq/testq setting flags, jg/jl/je/jne/ja/jb, cmovq, and label layout.", difficulty: 2, estMinutes: 50, prerequisites: ["asm-arithmetic"], related: ["asm-loops"], applications: ["if/else in hand-written assembly", "conditional moves for branchless code"], misconceptions: ["cmpq a, b compares a against b left-to-right", "jg is for unsigned", "labels need colons everywhere"], requires: ["asm-arithmetic"] },
  { nodeKey: "asm-loops", label: "Loops and Counters", definition: "Loop structure with a counter register, compare + conditional jump, and accumulator patterns.", difficulty: 2, estMinutes: 50, prerequisites: ["asm-control-flow"], related: [], applications: ["summation loops", "bounded iteration in low-level code"], misconceptions: ["loops need a separate index variable in memory", "incq is the only way to count", "the loop condition is checked after the body"], requires: ["asm-control-flow"] }
];

const SQL_FRONTIER: FrontierNode[] = [
  { nodeKey: "sql-select-basics", label: "SELECT Basics", definition: "SELECT columns FROM table, result row order, and why SELECT is a declarative description of a result set.", difficulty: 1, estMinutes: 40, prerequisites: [], related: ["sql-where"], applications: ["data exploration", "reporting queries"], misconceptions: ["SELECT runs top-to-bottom like code", "tables return rows in insertion order", "SELECT * is always fine"], requires: [] },
  { nodeKey: "sql-where", label: "Filtering with WHERE", definition: "WHERE predicates, single-quoted string literals, = vs LIKE, and NULL semantics (IS NULL).", difficulty: 1, estMinutes: 45, prerequisites: ["sql-select-basics"], related: ["sql-aggregates"], applications: ["user lookups", "audit filters"], misconceptions: ["double quotes are for strings", "= NULL matches NULLs", "LIKE and = are interchangeable"], requires: ["sql-select-basics"] },
  { nodeKey: "sql-aggregates", label: "Aggregates", definition: "SUM/COUNT/AVG over column values, NULL handling in aggregates, and scalar results.", difficulty: 2, estMinutes: 45, prerequisites: ["sql-where"], related: ["sql-group-by"], applications: ["KPI totals", "dashboard numbers"], misconceptions: ["SUM counts rows instead of adding", "aggregates can mix with plain columns freely", "COUNT(amount) and COUNT(*) are the same for NULLs"], requires: ["sql-where"] },
  { nodeKey: "sql-group-by", label: "GROUP BY", definition: "Grouping rows into buckets, COUNT(*)/SUM per bucket, and HAVING vs WHERE.", difficulty: 2, estMinutes: 50, prerequisites: ["sql-aggregates"], related: ["sql-joins"], applications: ["per-user statistics", "cohort analysis"], misconceptions: ["GROUP BY deduplicates like DISTINCT", "WHERE can filter grouped results", "every non-aggregate column must be grouped"], requires: ["sql-aggregates"] },
  { nodeKey: "sql-joins", label: "Joins", definition: "INNER JOIN on foreign keys, ON clauses, aliases, and the row-expansion model of joins.", difficulty: 2, estMinutes: 50, prerequisites: ["sql-group-by"], related: [], applications: ["relational reporting", "denormalized exports"], misconceptions: ["JOIN without ON is a syntax error everywhere", "aliases are optional decorations", "join order changes the result"], requires: ["sql-group-by"] },
  { nodeKey: "sql-write", label: "INSERT and UPDATE", definition: "INSERT INTO ... VALUES, UPDATE ... SET ... WHERE, and verifying effects with follow-up queries.", difficulty: 2, estMinutes: 45, prerequisites: ["sql-where"], related: [], applications: ["data entry", "migrations"], misconceptions: ["UPDATE without WHERE is always safe", "INSERT needs every column", "statements return rows by default"], requires: ["sql-where"] }
];

/* ------------------------------------------------------------------ */
/* Domain-scoped frontiers (language-agnostic concepts).               */
/* Node keys carry a domain prefix so the tutor can tell a domain node */
/* apart from a language node (isDomainNodeKey) and restrict its       */
/* curriculum activities accordingly.                                  */
/* ------------------------------------------------------------------ */

export const DOMAIN_PREFIXES = {
  NETWORKING: "net-",
  CYBERSECURITY: "sec-",
  LOW_LEVEL: "ll-",
  AI_ENGINEERING: "ai-",
  WEBDEV: "web-",
  SYSTEMS: "sys-"
} as const;

export function isDomainNodeKey(nodeKey: string): boolean {
  return Object.values(DOMAIN_PREFIXES).some((p) => nodeKey.startsWith(p));
}

const NETWORKING_FRONTIER: FrontierNode[] = [
  { nodeKey: "net-osi-model", label: "Layered Networking (OSI/Internet)", definition: "Why networks are layered: physical, link, internet (IP), transport (TCP/UDP), and application layers; encapsulation as each layer wraps the one above.", difficulty: 1, estMinutes: 40, prerequisites: [], related: ["net-ip-addressing", "net-tcp-udp"], applications: ["troubleshooting connectivity with traceroute", "reading packet captures"], misconceptions: ["layers are physical devices", "TCP and IP are the same protocol", "encapsulation only happens on the internet"], requires: [], requiresLanguageLevel: 2 },
  { nodeKey: "net-ip-addressing", label: "IP Addressing and Routing", definition: "IPv4/IPv6 addresses, subnet masks, network vs host bits, gateways, and how packets are routed hop by hop.", difficulty: 2, estMinutes: 45, prerequisites: ["net-osi-model"], related: ["net-dns"], applications: ["configuring local networks", "reading route tables"], misconceptions: ["the subnet mask is part of the address", "routers change the destination IP", "every host needs a public IP"], requires: ["net-osi-model"], requiresLanguageLevel: 3 },
  { nodeKey: "net-dns", label: "DNS Resolution", definition: "How domain names become IP addresses: recursive resolvers, A/AAAA records, caching, TTL, and common record types (CNAME, MX).", difficulty: 2, estMinutes: 40, prerequisites: ["net-ip-addressing"], related: ["net-tcp-udp"], applications: ["debugging 'no such host' errors", "understanding propagation delays"], misconceptions: ["DNS is a single server", "changing a record updates the world instantly", "TTL only matters for security"], requires: ["net-ip-addressing"], requiresLanguageLevel: 4 },
  { nodeKey: "net-tcp-udp", label: "TCP and UDP", definition: "Connection-oriented vs connectionless transport: ports, handshakes, sequencing, acknowledgments, and when each protocol is appropriate.", difficulty: 2, estMinutes: 45, prerequisites: ["net-osi-model"], related: ["net-http-rest"], applications: ["deciding protocol choice for an API", "reading ss/netstat output"], misconceptions: ["UDP is always unreliable and never used", "TCP guarantees delivery speed", "ports identify processes on any host"], requires: ["net-osi-model"], requiresLanguageLevel: 4 },
  { nodeKey: "net-http-rest", label: "HTTP and REST APIs", definition: "HTTP methods, status codes, headers, request/response structure, statelessness, and RESTful resource design.", difficulty: 2, estMinutes: 45, prerequisites: ["net-tcp-udp"], related: ["net-sockets"], applications: ["consuming and designing APIs", "debugging with curl"], misconceptions: ["status 200 always means success", "GET requests can never have a body", "REST requires JSON"], requires: ["net-tcp-udp"], requiresLanguageLevel: 5 },
  { nodeKey: "net-sockets", label: "Sockets and Connection Lifecycle", definition: "The socket abstraction: bind/listen/accept/connect, addresses and ports, half-closes, and why timeouts and keepalives matter.", difficulty: 3, estMinutes: 45, prerequisites: ["net-http-rest", "net-tcp-udp"], related: [], applications: ["building chat servers", "diagnosing connection resets"], misconceptions: ["connect() is synchronous with the peer", "one listen socket handles one client", "closing a socket frees memory instantly"], requires: ["net-http-rest", "net-tcp-udp"], requiresLanguageLevel: 6 }
];

const CYBERSECURITY_FRONTIER: FrontierNode[] = [
  { nodeKey: "sec-cia-triad", label: "CIA Triad", definition: "Confidentiality, integrity, availability as the security goals; how every control (encryption, hashing, backups) maps onto one of them.", difficulty: 1, estMinutes: 35, prerequisites: [], related: ["sec-threat-modeling", "sec-tls-https"], applications: ["categorizing incidents", "justifying security controls"], misconceptions: ["confidentiality is the only goal", "availability is not a security concern", "CIA is about preventing hackers only"], requires: [], requiresLanguageLevel: 2 },
  { nodeKey: "sec-threat-modeling", label: "Threat Modeling", definition: "Identifying assets, trust boundaries, adversaries, and attack surfaces; STRIDE as a systematic enumeration of threat types.", difficulty: 2, estMinutes: 45, prerequisites: ["sec-cia-triad"], related: ["sec-owasp"], applications: ["reviewing a new feature for risk", "writing security requirements"], misconceptions: ["threat modeling is a compliance checkbox", "only external attackers exist", "threats are bugs that can be fixed once"], requires: ["sec-cia-triad"], requiresLanguageLevel: 3 },
  { nodeKey: "sec-authn-authz", label: "Authentication and Authorization", definition: "Proving identity vs granting access: passwords, hashing and salting, sessions, tokens, MFA, and least-privilege authorization.", difficulty: 2, estMinutes: 45, prerequisites: ["sec-cia-triad"], related: ["sec-tls-https"], applications: ["designing a login flow", "auditing access control"], misconceptions: ["authN and authZ are the same step", "storing hashed passwords is enough without salts", "the frontend enforces authorization"], requires: ["sec-cia-triad"], requiresLanguageLevel: 3 },
  { nodeKey: "sec-tls-https", label: "TLS and HTTPS", definition: "Public-key cryptography for key exchange, certificates and certificate authorities, TLS handshakes, and why HTTPS is not optional.", difficulty: 2, estMinutes: 45, prerequisites: ["sec-authn-authz"], related: ["sec-owasp"], applications: ["enabling TLS on a service", "reading certificate errors"], misconceptions: ["HTTPS encrypts the hostname", "any HTTPS site is trustworthy", "certificates last forever and never expire"], requires: ["sec-authn-authz"], requiresLanguageLevel: 4 },
  { nodeKey: "sec-owasp", label: "OWASP Top 10", definition: "The most common web vulnerabilities: injection, broken access control, XSS, CSRF, SSRF, and the mitigations for each.", difficulty: 2, estMinutes: 50, prerequisites: ["sec-threat-modeling"], related: ["sec-secure-coding"], applications: ["auditing an API for injection", "writing an XSS-safe frontend"], misconceptions: ["input validation fixes injection everywhere", "SQL injection is a database problem", "frameworks make XSS impossible"], requires: ["sec-threat-modeling"], requiresLanguageLevel: 4 },
  { nodeKey: "sec-secure-coding", label: "Secure Coding Practices", definition: "Principles that prevent classes of vulnerabilities: parameterized queries, least privilege, validation and sanitization, secrets management, and defense in depth.", difficulty: 3, estMinutes: 50, prerequisites: ["sec-owasp"], related: [], applications: ["code review checklists", "storing API keys safely"], misconceptions: ["never logging secrets is optional", "one control is enough if it is strong", "security review happens after the feature ships"], requires: ["sec-owasp"], requiresLanguageLevel: 5 }
];

const LOW_LEVEL_FRONTIER: FrontierNode[] = [
  { nodeKey: "ll-binary", label: "Binary Representation", definition: "Signed integers (two's complement), fixed-width arithmetic, overflow, and how floats (IEEE-754) approximate real numbers.", difficulty: 1, estMinutes: 40, prerequisites: [], related: ["ll-memory-layout"], applications: ["predicting overflow bugs", "debugging NaN/infinity"], misconceptions: ["overflow throws an error", "float equals are exact for money", "sign-magnitude is how negatives work"], requires: [], requiresLanguageLevel: 2 },
  { nodeKey: "ll-memory-layout", label: "Memory Layout of a Program", definition: "Text, data, BSS, heap, and stack segments; what lives where, address direction, and alignment.", difficulty: 1, estMinutes: 40, prerequisites: ["ll-binary"], related: ["ll-pointers", "ll-call-stack"], applications: ["interpreting crash addresses", "estimating memory use"], misconceptions: ["the heap is faster than the stack", "static variables live on the stack", "layout is identical on every OS"], requires: ["ll-binary"], requiresLanguageLevel: 3 },
  { nodeKey: "ll-pointers", label: "Pointers and References", definition: "Pointers as memory addresses, dereferencing, pointer arithmetic, null and dangling pointers, and how references differ.", difficulty: 2, estMinutes: 45, prerequisites: ["ll-memory-layout"], related: ["ll-call-stack"], applications: ["linked structures", "interfacing with C APIs"], misconceptions: ["a pointer stores the value it points at", "pointer arithmetic adds bytes", "null dereferences always crash cleanly"], requires: ["ll-memory-layout"], requiresLanguageLevel: 3 },
  { nodeKey: "ll-call-stack", label: "The Call Stack", definition: "Frames, return addresses, local variables, arguments, and stack discipline; what stack traces actually show.", difficulty: 2, estMinutes: 40, prerequisites: ["ll-pointers"], related: ["ll-syscalls"], applications: ["reading backtraces", "understanding recursion limits"], misconceptions: ["the stack and heap are the same memory pool", "returning a pointer to a local is safe", "frames grow downward in every architecture's source code"], requires: ["ll-pointers"], requiresLanguageLevel: 4 },
  { nodeKey: "ll-syscalls", label: "System Calls", definition: "The kernel boundary: syscalls as the API of the OS, common families (file, process, memory), and how libraries wrap them.", difficulty: 2, estMinutes: 40, prerequisites: ["ll-memory-layout"], related: [], applications: ["tracing programs with strace", "writing minimal tools"], misconceptions: ["printf is a syscall", "every syscall is available on every platform", "libc functions are the kernel API"], requires: ["ll-memory-layout"], requiresLanguageLevel: 4 },
  { nodeKey: "ll-memory-safety", label: "Memory Safety", definition: "Out-of-bounds, use-after-free, double-free, and buffer overflows; why languages differ in safety and what mitigations exist.", difficulty: 3, estMinutes: 50, prerequisites: ["ll-pointers", "ll-call-stack"], related: [], applications: ["choosing safe abstractions", "auditing C code"], misconceptions: ["memory errors always crash immediately", "compiler warnings prevent exploitation", "safe languages have no memory issues"], requires: ["ll-pointers", "ll-call-stack"], requiresLanguageLevel: 5 }
];

const AI_ENGINEERING_FRONTIER: FrontierNode[] = [
  { nodeKey: "ai-ml-basics", label: "Machine Learning Fundamentals", definition: "Learning from data vs explicit programming: training data, models, parameters, and the difference between memorization and generalization.", difficulty: 1, estMinutes: 40, prerequisites: [], related: ["ai-features-labels", "ai-training-eval"], applications: ["evaluating claims about AI products"], misconceptions: ["models store the training data", "more data always means better models", "ML is just statistics turned into marketing"], requires: [], requiresLanguageLevel: 2 },
  { nodeKey: "ai-features-labels", label: "Features, Labels, and Data Quality", definition: "What models consume: features as inputs, labels as targets, class imbalance, leakage, and why garbage data produces garbage models.", difficulty: 2, estMinutes: 40, prerequisites: ["ai-ml-basics"], related: ["ai-training-eval"], applications: ["preparing datasets", "spotting leakage in pipelines"], misconceptions: ["labels are always available after training", "more features are always better", "imbalance only matters for classification"], requires: ["ai-ml-basics"], requiresLanguageLevel: 3 },
  { nodeKey: "ai-training-eval", label: "Training and Evaluation", definition: "Train/validation/test splits, overfitting, metrics (accuracy, precision, recall), and how evaluation sets measure real performance.", difficulty: 2, estMinutes: 45, prerequisites: ["ai-features-labels"], related: ["ai-prompts-llms"], applications: ["interpreting model reports", "designing eval sets"], misconceptions: ["accuracy is always the right metric", "validation data can be reused for training", "a model that fits training data is good"], requires: ["ai-features-labels"], requiresLanguageLevel: 4 },
  { nodeKey: "ai-prompts-llms", label: "Prompting and LLM Behavior", definition: "How LLMs produce text, the role of prompts and context, temperature, tokens, and why outputs are probabilistic.", difficulty: 1, estMinutes: 40, prerequisites: [], related: ["ai-training-eval", "ai-llm-integration"], applications: ["writing effective prompts", "debugging unreliable model output"], misconceptions: ["LLMs have memory of previous conversations by default", "longer prompts are always better", "the model verifies its own answers"], requires: [], requiresLanguageLevel: 2 },
  { nodeKey: "ai-llm-integration", label: "LLM API Integration", definition: "Calling model APIs: structured outputs, JSON schemas, retries, rate limits, cost, and validating outputs before use.", difficulty: 2, estMinutes: 45, prerequisites: ["ai-prompts-llms"], related: ["ai-eval-harness"], applications: ["building AI features", "handling flaky providers"], misconceptions: ["the provider guarantees correct JSON", "retries always solve failures", "validation is unnecessary because models are smart"], requires: ["ai-prompts-llms"], requiresLanguageLevel: 4 },
  { nodeKey: "ai-eval-harness", label: "Evaluation Harnesses for AI Systems", definition: "Deterministic tests around model outputs: contract checks, golden tests, regression suites, and guarding state with explicit systems.", difficulty: 3, estMinutes: 50, prerequisites: ["ai-training-eval", "ai-llm-integration"], related: [], applications: ["shipping AI features safely", "running prompt regressions"], misconceptions: ["manual spot checks are a sufficient eval", "one good prompt is a permanent solution", "evaluation happens once at launch"], requires: ["ai-training-eval", "ai-llm-integration"], requiresLanguageLevel: 5 }
];

const WEBDEV_FRONTIER: FrontierNode[] = [
  { nodeKey: "web-html", label: "HTML Structure and Semantics", definition: "Document structure with semantic elements (header, nav, main, article), attributes, and why semantics matter for accessibility.", difficulty: 1, estMinutes: 35, prerequisites: [], related: ["web-css"], applications: ["building accessible pages", "seo-friendly markup"], misconceptions: ["div everywhere is fine", "heading levels are styling", "semantics are only for screen readers"], requires: [], requiresLanguageLevel: 2 },
  { nodeKey: "web-css", label: "CSS Layout and Specificity", definition: "The box model, cascading and specificity, flexbox and grid, responsive units, and centering the notorious unknown.", difficulty: 1, estMinutes: 40, prerequisites: ["web-html"], related: ["web-js-dom"], applications: ["laying out pages", "debugging style conflicts"], misconceptions: ["!important is a reasonable default", "flexbox is a layout for text", "pixel units are always the right choice"], requires: ["web-html"], requiresLanguageLevel: 3 },
  { nodeKey: "web-js-dom", label: "JavaScript and the DOM", definition: "Selecting and mutating DOM nodes, event listeners and bubbling, and re-render cost — when the page must change.", difficulty: 2, estMinutes: 45, prerequisites: ["web-css"], related: ["web-http-forms"], applications: ["interactive widgets", "client-side validation"], misconceptions: ["innerHTML is the fast way to update", "events bubble everywhere equally", "the DOM is the same as the HTML string"], requires: ["web-css"], requiresLanguageLevel: 3 },
  { nodeKey: "web-http-forms", label: "Forms and HTTP Requests", definition: "Form submission, method/action, input validation, and client-server data flow: from form fields to server-side processing.", difficulty: 2, estMinutes: 40, prerequisites: ["web-js-dom"], related: ["web-rest-clients"], applications: ["building signup flows", "debugging broken submissions"], misconceptions: ["client-side validation is sufficient", "GET forms can submit large data", "form data is encrypted by default"], requires: ["web-js-dom"], requiresLanguageLevel: 4 },
  { nodeKey: "web-rest-clients", label: "Fetch and REST Clients", definition: "fetch/XMLHttpRequest, promises and async/await, JSON handling, error handling for HTTP statuses, and aborting requests.", difficulty: 2, estMinutes: 45, prerequisites: ["web-http-forms"], related: ["web-security"], applications: ["loading data into pages", "handling API failures"], misconceptions: ["fetch rejects on HTTP 404", "async/await makes code single-threaded-free", "response.json() can be called twice safely"], requires: ["web-http-forms"], requiresLanguageLevel: 4 },
  { nodeKey: "web-security", label: "Web Security Basics", definition: "CORS, CSRF, XSS in the browser, content security policy, and the security responsibilities of the client.", difficulty: 2, estMinutes: 45, prerequisites: ["web-rest-clients"], related: [], applications: ["securing a frontend", "reviewing browser console warnings"], misconceptions: ["CORS is a server-side-only concern", "escaping user input is optional for internal tools", "a frontend can keep secrets from users"], requires: ["web-rest-clients"], requiresLanguageLevel: 5 }
];

const SYSTEMS_FRONTIER: FrontierNode[] = [
  { nodeKey: "sys-processes", label: "Processes and the OS", definition: "What a process is: address space, state, scheduling, and process vs thread; how the OS multiplexes hardware.", difficulty: 1, estMinutes: 40, prerequisites: [], related: ["sys-filesystem", "sys-ipc"], applications: ["interpreting ps/top output", "debugging resource use"], misconceptions: ["a process is just a running program", "more cores mean a single process speeds up", "threads share nothing"], requires: [], requiresLanguageLevel: 2 },
  { nodeKey: "sys-filesystem", label: "Filesystems and Paths", definition: "Files as inodes, directories as maps, absolute vs relative paths, mounts, and how the filesystem is a tree users navigate.", difficulty: 1, estMinutes: 35, prerequisites: ["sys-processes"], related: ["sys-permissions"], applications: ["navigating servers", "understanding disk full errors"], misconceptions: ["a file is a contiguous blob on disk", "deleting a file erases its data instantly", "paths are the same everywhere on the system"], requires: ["sys-processes"], requiresLanguageLevel: 3 },
  { nodeKey: "sys-permissions", label: "Unix Permissions and Ownership", definition: "Read/write/execute bits for user/group/other, octal notation, umask, sticky bits, and why permissions are checked once at open.", difficulty: 2, estMinutes: 40, prerequisites: ["sys-filesystem"], related: ["sys-ipc"], applications: ["fixing 'permission denied'", "securing shared directories"], misconceptions: ["write permission implies execute", "permissions are re-checked on every read", "root ignores permission bits entirely"], requires: ["sys-filesystem"], requiresLanguageLevel: 3 },
  { nodeKey: "sys-ipc", label: "Process Communication", definition: "Pipes, signals, exit codes, and inter-process communication patterns; what a shell pipeline actually does between processes.", difficulty: 2, estMinutes: 45, prerequisites: ["sys-processes"], related: ["sys-shell-pipeline"], applications: ["chaining tools", "writing daemons"], misconceptions: ["signals are just interrupts from the keyboard", "a pipe buffers everything in memory", "exit codes are error numbers"], requires: ["sys-processes"], requiresLanguageLevel: 4 },
  { nodeKey: "sys-shell-pipeline", label: "The Shell and Pipelines", definition: "Command composition: streams (stdin/stdout/stderr), pipelines, redirection, exit statuses, and why 'the shell' is a program like any other.", difficulty: 2, estMinutes: 40, prerequisites: ["sys-ipc"], related: [], applications: ["automating servers", "debugging pipeline failures"], misconceptions: ["the shell is the OS", "pipeline segments run one at a time", "stderr goes through pipes by default"], requires: ["sys-ipc"], requiresLanguageLevel: 4 },
  { nodeKey: "sys-deploy", label: "Deployment and Runtime Concerns", definition: "Containers, images, ports, environment, health checks, and the deployment lifecycle from build to running service.", difficulty: 2, estMinutes: 45, prerequisites: ["sys-permissions"], related: [], applications: ["deploying services", "diagnosing 'works locally' failures"], misconceptions: ["containers are lightweight VMs", "localhost in a container is the host", "a healthy container means a healthy service"], requires: ["sys-permissions"], requiresLanguageLevel: 5 }
];

export const DOMAIN_FRONTIERS: Record<string, FrontierNode[]> = {
  NETWORKING: NETWORKING_FRONTIER,
  CYBERSECURITY: CYBERSECURITY_FRONTIER,
  LOW_LEVEL: LOW_LEVEL_FRONTIER,
  AI_ENGINEERING: AI_ENGINEERING_FRONTIER,
  WEBDEV: WEBDEV_FRONTIER,
  SYSTEMS: SYSTEMS_FRONTIER
};

const FRONTIERS: Record<string, FrontierNode[]> = {
  cpp: CPP_FRONTIER,
  python: PYTHON_FRONTIER,
  rust: RUST_FRONTIER,
  c: C_FRONTIER,
  bash: BASH_FRONTIER,
  js: JS_FRONTIER,
  asm: ASM_FRONTIER,
  sql: SQL_FRONTIER
};

/* ------------------------------------------------------------------ */
/* Expansion                                                           */
/* ------------------------------------------------------------------ */

export function templateExpansion(languageKey: string): DomainExpansion {
  const frontier = FRONTIERS[languageKey] ?? [];
  return {
    nodes: frontier.map(({ requires: _r, ...node }) => ({ ...node, prerequisites: node.prerequisites, related: node.related })),
    source: "TEMPLATE"
  };
}

export async function expandDomainModel(
  db: DB,
  languageKey: string,
  masteredNodeKeys: string[],
  domains: string[] = [],
  learnerNodeKeys: string[] = []
): Promise<DomainExpansion> {
  const existing = await db
    .select({ nodeKey: domainNodes.nodeKey })
    .from(domainNodes)
    .where(eq(domainNodes.languageKey, languageKey));
  const existingSet = new Set(existing.map((r) => r.nodeKey));
  const learnerSet = new Set(learnerNodeKeys);
  const frontier = FRONTIERS[languageKey] ?? [];
  const domainNodesAvailable = domains.flatMap((d) => DOMAIN_FRONTIERS[d] ?? []);

  const languageLevel = masteredNodeKeys.length;
  const available = [...domainNodesAvailable, ...frontier].filter(
    (n) => {
      const present = isDomainNodeKey(n.nodeKey) ? learnerSet.has(n.nodeKey) : existingSet.has(n.nodeKey);
      return (
        !present &&
        (isDomainNodeKey(n.nodeKey) ? languageLevel >= (n.requiresLanguageLevel ?? 1) : true) &&
        n.requires.every((r) =>
          isDomainNodeKey(n.nodeKey) ? masteredNodeKeys.includes(r) : masteredNodeKeys.includes(r) || existingSet.has(r)
        )
      );
    }
  );
  if (available.length > 0) {
    return {
      nodes: available.slice(0, Math.max(2, Math.ceil(available.length / 2))).map(({ requires: _r, ...node }) => node),
      source: "TEMPLATE"
    };
  }

  // AI expansion beyond the template frontier
  const ai = await structured(
    z.object({ nodes: z.array(newNodeSchema).min(1).max(4) }),
    [
      {
        role: "system",
        content:
          "You are the domain-model builder of a programming tutor. Given a learner's mastered concepts in a language, propose the NEXT set of domain nodes (concepts) to model. Nodes must be specific, canonical, and ordered by prerequisites. Respond with JSON: {\"nodes\":[{nodeKey,label,definition,prerequisites:[existing node keys],related:[],difficulty,estMinutes,applications:[],misconceptions:[]}]}."
      },
      {
        role: "user",
        content: `language=${languageKey}\nmastered node keys=[${masteredNodeKeys.join(", ")}]\nexisting node keys=[${[...existingSet].join(", ")}]\n\nPropose nodes that build on these. nodeKey must be lowercase-hyphenated and unique.`
      }
    ]
  );

  if (ai) {
    return { nodes: ai.nodes, source: "AI" };
  }
  return { nodes: [], source: "TEMPLATE" };
}

/** Insert new nodes + edges into the graph (idempotent by nodeKey). */
export async function insertExpansion(db: DB, languageKey: string, expansion: DomainExpansion): Promise<string[]> {
  const created: string[] = [];
  for (const node of expansion.nodes) {
    const existing = await db
      .select({ id: domainNodes.id })
      .from(domainNodes)
      .where(and(eq(domainNodes.languageKey, languageKey), eq(domainNodes.nodeKey, node.nodeKey)));
    if (existing.length > 0) {
      created.push(existing[0]!.id);
      continue;
    }
    const [row] = await db
      .insert(domainNodes)
      .values({
        languageKey,
        nodeKey: node.nodeKey,
        label: node.label,
        definition: node.definition,
        difficulty: node.difficulty,
        estMinutes: node.estMinutes,
        depth: 0,
        status: "MODELED",
        source: expansion.source === "AI" ? "AI_GENERATED" : "PROVIDER_SEED",
        applications: node.applications,
        misconceptions: node.misconceptions
      })
      .returning({ id: domainNodes.id });
    created.push(row!.id);

    const allNodes = await db
      .select({ id: domainNodes.id, nodeKey: domainNodes.nodeKey })
      .from(domainNodes)
      .where(eq(domainNodes.languageKey, languageKey));
    const byKey = new Map(allNodes.map((n) => [n.nodeKey, n.id]));
    for (const prereq of node.prerequisites) {
      const pid = byKey.get(prereq);
      if (pid) {
        await db
          .insert(domainEdges)
          .values({ fromId: pid, toId: row!.id, kind: "PREREQUISITE" })
          .onConflictDoNothing();
      }
    }
    for (const rel of node.related) {
      const rid = byKey.get(rel);
      if (rid) {
        await db.insert(domainEdges).values({ fromId: row!.id, toId: rid, kind: "RELATED" }).onConflictDoNothing();
      }
    }
  }
  return created;
}

/** Deterministic seed for template generation per node. */
export function nodeSeed(languageKey: string, nodeKey: string): number {
  let h = 2166136261;
  for (const c of `${languageKey}:${nodeKey}`) {
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  }
  return h >>> 0;
}

export { mulberry32 };