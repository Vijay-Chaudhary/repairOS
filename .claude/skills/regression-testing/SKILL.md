---
name: regression-testing
description: Run per-module regression testing across the RepairOS backend and produce a pass/fail report. Use when asked to regression-test the project, verify nothing broke across modules, or produce a per-module test-status report before merging.
---

# Regression Testing (RepairOS backend)

Verify that existing behaviour still works across every backend module, module by module,
and produce a report that pinpoints exactly which module regressed.

## When to use
- Before merging a change that touches shared code (`core`, settings, models base classes).
- After a dependency bump or migration change.
- When the user asks to "regression test", "check nothing broke", or wants per-module test status.

## How to run

```bash
cd backend
# ensure PDF deps are present (commissions/hr/reports render PDFs):
python -c "import weasyprint" || pip install weasyprint==69.0
python scripts/regression_report.py            # all modules
python scripts/regression_report.py --modules repair crm   # a subset
```

Outputs:
- `docs/modules/REGRESSION.md` — human-readable table (module × passed/failed/errors/time).
- `docs/modules/regression.json` — machine-readable, for CI or diffing across runs.
- Exit code is non-zero if any module regressed, so it can gate CI.

## Method (do NOT shortcut)
1. Each module runs in its **own** pytest process, so a failure in one module cannot mask or
   cascade into another — the report attributes every failure to a specific module.
2. Coverage gate is disabled for the run (`-o addopts=`); this is about pass/fail, not coverage.
   Run `pytest` normally if you need the 80% coverage gate.
3. If a module regresses, **do not** guess a fix. Switch to the `systematic-debugging` skill:
   reproduce the single failing test with `-x --tb=long`, find the root cause, then fix.
4. Compare `regression.json` against the previous run to confirm you introduced no *new*
   failures (the weasyprint PDF paths are the only expected failures in an env without weasyprint).

## Baseline (2026-07-12, master)
844 tests, all green with weasyprint installed. Without weasyprint, expect exactly 10 failures
in `commissions` (7), `reports` (2), `hr` (1) — all PDF-render paths, not code defects.
See `docs/modules/README.md` for the full debug verdict.
