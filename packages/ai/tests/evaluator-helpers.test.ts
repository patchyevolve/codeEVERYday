import { describe, it, expect } from "vitest";
import {
  sanitizerPattern,
  mistakeSeverityFrom,
  outcomeFor,
} from "../src/evaluator.js";

describe("sanitizerPattern", () => {
  it("detects AddressSanitizer", () => {
    expect(sanitizerPattern("AddressSanitizer: heap-use-after-free")).toBe(
      "null_deref"
    );
  });
  it("detects UndefinedBehaviorSanitizer", () => {
    expect(
      sanitizerPattern("UndefinedBehaviorSanitizer: runtime error")
    ).toBe("overflow");
  });
  it("detects LeakSanitizer", () => {
    expect(sanitizerPattern("LeakSanitizer: leak detected")).toBe("mem_leak");
  });
  it("returns null for non-sanitizer output", () => {
    expect(sanitizerPattern("normal error")).toBeNull();
  });
  it("detects heap-use-after-free without ASan prefix", () => {
    expect(sanitizerPattern("heap-use-after-free on address 0x123")).toBe(
      "null_deref"
    );
  });
  it("detects stack-buffer-overflow", () => {
    expect(sanitizerPattern("stack-buffer-overflow")).toBe("buffer_overflow");
  });
  it("detects generic leak keyword", () => {
    expect(sanitizerPattern("mem leak found in allocation")).toBe("mem_leak");
  });
  it("detects generic runtime error", () => {
    expect(sanitizerPattern("runtime error: signed integer overflow")).toBe(
      "overflow"
    );
  });
});

describe("mistakeSeverityFrom", () => {
  it("returns HIGH for null_deref", () => {
    expect(mistakeSeverityFrom("null_deref")).toBe("HIGH");
  });
  it("returns HIGH for uninitialized", () => {
    expect(mistakeSeverityFrom("uninitialized")).toBe("HIGH");
  });
  it("returns HIGH for mem_leak", () => {
    expect(mistakeSeverityFrom("mem_leak")).toBe("HIGH");
  });
  it("returns LOW for syntax_error", () => {
    expect(mistakeSeverityFrom("syntax_error")).toBe("LOW");
  });
  it("returns LOW for type_error", () => {
    expect(mistakeSeverityFrom("type_error")).toBe("LOW");
  });
  it("returns LOW for complexity_error", () => {
    expect(mistakeSeverityFrom("complexity_error")).toBe("LOW");
  });
  it("returns MEDIUM for logic_error", () => {
    expect(mistakeSeverityFrom("logic_error")).toBe("MEDIUM");
  });
  it("returns MEDIUM for overflow", () => {
    expect(mistakeSeverityFrom("overflow")).toBe("MEDIUM");
  });
  it("returns MEDIUM for misread_problem", () => {
    expect(mistakeSeverityFrom("misread_problem")).toBe("MEDIUM");
  });
});

describe("outcomeFor", () => {
  it("returns firstTry when passed on first attempt with no hints", () => {
    const result = outcomeFor("PASS", 1, 0, "exercise", 0.5);
    expect(result.passed).toBe(true);
    expect(result.firstTry).toBe(true);
    expect(result.hintsUsed).toBe(0);
  });
  it("returns not firstTry when hints used", () => {
    const result = outcomeFor("PASS", 1, 2, "exercise", 0.5);
    expect(result.firstTry).toBe(false);
    expect(result.hintsUsed).toBe(2);
  });
  it("returns not firstTry on retry", () => {
    const result = outcomeFor("PASS", 2, 0, "exercise", 0.5);
    expect(result.firstTry).toBe(false);
  });
  it("sets failCount to attempt - 1", () => {
    const result = outcomeFor("PASS", 3, 0, "exercise", 0.5);
    expect(result.failCount).toBe(2);
  });
  it("passes through kind and difficulty", () => {
    const result = outcomeFor("PASS", 1, 0, "assessment", 0.8);
    expect(result.kind).toBe("assessment");
    expect(result.difficulty).toBe(0.8);
  });
  it("returns passed false for FAIL verdict", () => {
    const result = outcomeFor("FAIL", 1, 0, "exercise", 0.5);
    expect(result.passed).toBe(false);
    expect(result.firstTry).toBe(false);
  });
  it("returns passed false for COMPILE_ERROR", () => {
    const result = outcomeFor("COMPILE_ERROR", 1, 0, "exercise", 0.5);
    expect(result.passed).toBe(false);
  });
  it("returns failCount 0 on first attempt", () => {
    const result = outcomeFor("FAIL", 1, 0, "exercise", 0.5);
    expect(result.failCount).toBe(0);
  });
  it("works for review kind", () => {
    const result = outcomeFor("PASS", 1, 0, "review", 3);
    expect(result.kind).toBe("review");
    expect(result.difficulty).toBe(3);
  });
  it("works for remediation kind", () => {
    const result = outcomeFor("PASS", 1, 0, "remediation", 2);
    expect(result.kind).toBe("remediation");
  });
});
