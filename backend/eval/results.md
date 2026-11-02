# Product-check evaluation

Labels are hand-written against the fictional demo catalog in `cases.json`. This set is small and was written by the builders of the rules, so it shows the logic behaves as specified, not real-world accuracy.

| Case | Parser | ProofPick correct | Baseline correct | Baseline unsupported passes |
|---|---|---|---|---|
| ordinary_match | match | 16/16 | 10/16 | 5 |
| excluded_material_only | match | 7/7 | 3/7 | 3 |
| price_boundary_inclusive | match | 3/3 | 3/3 | 0 |
| price_boundary_exclusive | match | 3/3 | 2/3 | 1 |
| excluded_wool | match | 5/5 | 3/5 | 2 |
| synonym_elastane | match | 3/3 | 2/3 | 1 |
| short_sleeve_crew | match | 3/3 | 2/3 | 1 |
| missing_sleeve_text | match | 3/3 | 2/3 | 1 |
| missing_neckline_text | match | 3/3 | 2/3 | 1 |
| impossible_combination | match | 4/4 | 4/4 | 0 |
| lining_unknown | match | 3/3 | 1/3 | 2 |
| conflicting_sources_and_injection | match | 3/3 | 2/3 | 0 |

Parser (rules mode) exact matches: 12/12
ProofPick labeled outcomes correct: 56/56
Baseline labeled outcomes correct: 36/56
Impossible requests with no eligible product: 1/1

Misses:
none

## Real garments

Not run: add eval/real_cases.json (see real_cases.example.json).
