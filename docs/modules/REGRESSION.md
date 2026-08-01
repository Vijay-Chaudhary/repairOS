# RepairOS Backend — Regression Report

_Generated: 2026-07-12 10:17 UTC · `python scripts/regression_report.py`_

**Overall: ✅ PASS** — 844/844 tests passing across 15 modules in 129.6s (isolated per-module runs).

| Module | Tests | Passed | Failed | Errors | Time (s) | Status |
|---|---:|---:|---:|---:|---:|---|
| `accounts` | 59 | 59 | 0 | 0 | 10.26 | ✅ |
| `amc` | 21 | 21 | 0 | 0 | 6.47 | ✅ |
| `authentication` | 56 | 56 | 0 | 0 | 6.4 | ✅ |
| `billing` | 40 | 40 | 0 | 0 | 14.8 | ✅ |
| `commissions` | 23 | 23 | 0 | 0 | 9.71 | ✅ |
| `core` | 130 | 130 | 0 | 0 | 12.46 | ✅ |
| `crm` | 117 | 117 | 0 | 0 | 8.04 | ✅ |
| `finance` | 30 | 30 | 0 | 0 | 6.47 | ✅ |
| `hr` | 35 | 35 | 0 | 0 | 8.92 | ✅ |
| `inventory` | 26 | 26 | 0 | 0 | 6.38 | ✅ |
| `master` | 82 | 82 | 0 | 0 | 7.19 | ✅ |
| `pos` | 43 | 43 | 0 | 0 | 6.8 | ✅ |
| `procurement` | 39 | 39 | 0 | 0 | 6.81 | ✅ |
| `repair` | 94 | 94 | 0 | 0 | 8.39 | ✅ |
| `reports` | 49 | 49 | 0 | 0 | 10.53 | ✅ |

## Notes
- Each module is run in a **separate** pytest process so a failure in one module
  cannot mask or cascade into another.
- Coverage gate is disabled here (`-o addopts=`); this run is about pass/fail, not coverage.
- PDF paths (commissions/hr/reports) require `weasyprint` — install it or expect those to fail.
