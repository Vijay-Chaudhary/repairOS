#!/usr/bin/env python3
"""Per-module regression runner for the RepairOS backend.

Runs each Django app's test suite in isolation (no coverage gate) and writes a
regression report to docs/modules/REGRESSION.md plus a machine-readable
regression.json next to it.

Usage:
    cd backend && python scripts/regression_report.py
    cd backend && python scripts/regression_report.py --modules repair crm

Exit code is non-zero if any module regressed (failures/errors), so it can gate CI.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
APPS = BACKEND / "apps"
REPORT_DIR = BACKEND.parent / "docs" / "modules"

# Summary line variants pytest emits, e.g.
#   "59 passed in 2.10s"  |  "16 passed, 7 failed in 3.0s"  |  "1 error in 0.5s"
COUNT_RE = re.compile(r"(\d+)\s+(passed|failed|error|errors|skipped|xfailed|xpassed)")


def discover_modules() -> list[str]:
    mods = []
    for p in sorted(APPS.iterdir()):
        if p.is_dir() and (p / "tests").is_dir() and any(p.glob("tests/test_*.py")):
            mods.append(p.name)
    return mods


def run_module(mod: str) -> dict:
    start = time.perf_counter()
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", f"apps/{mod}/tests",
         "-p", "no:cacheprovider", "-o", "addopts=", "-q", "--tb=line"],
        cwd=BACKEND, capture_output=True, text=True,
    )
    dur = time.perf_counter() - start
    tail = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""
    counts = {k: 0 for k in ("passed", "failed", "error", "skipped")}
    for n, kind in COUNT_RE.findall(tail):
        key = "error" if kind.startswith("error") else kind
        if key in counts:
            counts[key] += int(n)
    total = counts["passed"] + counts["failed"] + counts["error"]
    ok = proc.returncode == 0 and counts["failed"] == 0 and counts["error"] == 0
    return {
        "module": mod,
        "total": total,
        "duration_s": round(dur, 2),
        "returncode": proc.returncode,
        "ok": ok,
        "summary": tail,
        **counts,
    }


def write_report(results: list[dict]) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    total_tests = sum(r["total"] for r in results)
    total_fail = sum(r["failed"] + r["error"] for r in results)
    total_dur = round(sum(r["duration_s"] for r in results), 1)
    overall = "✅ PASS" if total_fail == 0 else f"❌ {total_fail} regression(s)"

    lines = [
        "# RepairOS Backend — Regression Report",
        "",
        f"_Generated: {ts} · `python scripts/regression_report.py`_",
        "",
        f"**Overall: {overall}** — {total_tests - total_fail}/{total_tests} tests passing "
        f"across {len(results)} modules in {total_dur}s (isolated per-module runs).",
        "",
        "| Module | Tests | Passed | Failed | Errors | Time (s) | Status |",
        "|---|---:|---:|---:|---:|---:|---|",
    ]
    for r in results:
        status = "✅" if r["ok"] else "❌"
        lines.append(
            f"| `{r['module']}` | {r['total']} | {r['passed']} | {r['failed']} "
            f"| {r['error']} | {r['duration_s']} | {status} |"
        )
    lines += [
        "",
        "## Notes",
        "- Each module is run in a **separate** pytest process so a failure in one module",
        "  cannot mask or cascade into another.",
        "- Coverage gate is disabled here (`-o addopts=`); this run is about pass/fail, not coverage.",
        "- PDF paths (commissions/hr/reports) require `weasyprint` — install it or expect those to fail.",
        "",
    ]
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / "REGRESSION.md").write_text("\n".join(lines))
    (REPORT_DIR / "regression.json").write_text(json.dumps(
        {"generated": ts, "results": results}, indent=2))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--modules", nargs="*", help="subset of modules to run")
    args = ap.parse_args()

    mods = args.modules or discover_modules()
    results = []
    for m in mods:
        print(f"→ {m} ...", flush=True)
        r = run_module(m)
        results.append(r)
        print(f"   {r['summary']}  [{'ok' if r['ok'] else 'FAIL'}]")

    write_report(results)
    regressions = [r["module"] for r in results if not r["ok"]]
    print("\n" + ("All modules green." if not regressions
                  else f"Regressions in: {', '.join(regressions)}"))
    print(f"Report: {REPORT_DIR / 'REGRESSION.md'}")
    return 1 if regressions else 0


if __name__ == "__main__":
    raise SystemExit(main())
