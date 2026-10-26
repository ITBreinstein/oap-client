/**
 * Every skipped test, and why, at the end of the run (reliability task,
 * 2026-10-26). "200 passed" must not hide "12 skipped": locally,
 * `requireService` skips a test whose service is not answering, and a test
 * can also end up not run at all, as one did in step zero after an error
 * outside any test. Both are listed here, the second with what is known.
 *
 * Added beside the lane's usual reporter in `playwright.config.ts`. Prints
 * nothing when nothing was skipped.
 */

import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

export default class SkipReporter implements Reporter {
  private readonly skipped: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "skipped") return;
    const reasons = result.annotations
      .filter((annotation) => annotation.type === "skip")
      .map((annotation) => annotation.description ?? "no reason given");
    const why =
      reasons.length > 0
        ? reasons.join("; ")
        : "did not run, with no reason given: see any error reported outside a test above";
    const where = `${test.location.file.replace(/^.*\/e2e\//, "e2e/")}:${String(test.location.line)}`;
    this.skipped.push(`  - ${where} ${test.title} — ${why}`);
  }

  onEnd(result: FullResult): void {
    if (this.skipped.length === 0) return;
    console.log(
      [
        "",
        `${String(this.skipped.length)} skipped (run ${result.status}), and why:`,
        ...this.skipped,
        "",
      ].join("\n"),
    );
  }

  printsToStdio(): boolean {
    return false;
  }
}
