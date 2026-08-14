import { describe, expect, it } from "vitest";
import { locateExcerpt, mergeIssues } from "@/lib/llm-grammar";
import type { GrammarIssue } from "@/lib/grammar";

/**
 * The LLM pass is only as safe as its excerpt matching. A model that quotes
 * text it never saw must produce zero highlighted spans, not a span at a
 * plausible-looking offset.
 */

function issue(offset: number, length: number, rule = "r"): GrammarIssue {
  return {
    rule,
    category: "grammar",
    severity: "warning",
    message: "m",
    suggestion: null,
    offset,
    length,
    excerpt: "",
    context: "",
  };
}

describe("locateExcerpt", () => {
  const text = "The committee were meeting on Tuesday to review it.";

  it("finds a verbatim excerpt", () => {
    const span = locateExcerpt(text, "committee were meeting");
    expect(span).not.toBeNull();
    expect(text.slice(span!.offset, span!.offset + span!.length)).toBe(
      "committee were meeting",
    );
  });

  it("tolerates differing whitespace", () => {
    const spaced = "The  committee\nwere   meeting today.";
    const span = locateExcerpt(spaced, "committee were meeting");
    expect(span).not.toBeNull();
  });

  it("returns null for text that is not present", () => {
    expect(locateExcerpt(text, "the dog barked loudly")).toBeNull();
  });

  it("returns null for a trivially short excerpt", () => {
    expect(locateExcerpt(text, "a")).toBeNull();
    expect(locateExcerpt(text, " ")).toBeNull();
  });

  it("searches from a cursor to keep repeated phrases in order", () => {
    const repeated = "it was fine. later it was fine again.";
    const first = locateExcerpt(repeated, "it was fine")!;
    const second = locateExcerpt(repeated, "it was fine", first.offset + first.length)!;
    expect(second.offset).toBeGreaterThan(first.offset);
  });

  it("does not throw on regex metacharacters", () => {
    const tricky = "The cost (in dollars) rose 5% [approx].";
    expect(() => locateExcerpt(tricky, "(in dollars)")).not.toThrow();
    expect(locateExcerpt(tricky, "(in dollars)")).not.toBeNull();
  });
});

describe("mergeIssues", () => {
  it("keeps LLM issues that do not overlap rule issues", () => {
    const merged = mergeIssues([issue(0, 5, "rule-a")], [issue(20, 5, "llm-x")]);
    expect(merged).toHaveLength(2);
  });

  it("discards LLM issues overlapping a rule issue", () => {
    const merged = mergeIssues([issue(10, 10, "rule-a")], [issue(15, 5, "llm-x")]);
    expect(merged).toHaveLength(1);
    expect(merged[0].rule).toBe("rule-a");
  });

  it("discards on partial overlap at either edge", () => {
    expect(mergeIssues([issue(10, 10)], [issue(5, 8)])).toHaveLength(1);
    expect(mergeIssues([issue(10, 10)], [issue(18, 8)])).toHaveLength(1);
  });

  it("keeps an issue that starts exactly where another ends", () => {
    expect(mergeIssues([issue(10, 5)], [issue(15, 5)])).toHaveLength(2);
  });

  it("returns results sorted by offset", () => {
    const merged = mergeIssues(
      [issue(50, 2), issue(10, 2)],
      [issue(30, 2), issue(70, 2)],
    );
    expect(merged.map((i) => i.offset)).toEqual([10, 30, 50, 70]);
  });

  it("handles empty inputs", () => {
    expect(mergeIssues([], [])).toEqual([]);
    expect(mergeIssues([issue(0, 3)], [])).toHaveLength(1);
    expect(mergeIssues([], [issue(0, 3)])).toHaveLength(1);
  });
});
