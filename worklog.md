---
Task ID: 1
Agent: Main Agent
Task: Fix Amazon price extraction - AOD-only with strict verification

Work Log:
- Read all 6 Python files (base_worker.py, egypt.py, germany.py, saudi.py, uae.py, usa.py)
- Analyzed the price extraction flow in each file
- Identified 3 key issues: ATC button fallback, alternative product price leakage, main page fallback

Stage Summary:
- base_worker.py: Removed ATC button fallback from `_extract_scoped_aod_price()`, added `_AOD_ALTERNATIVE_SELECTORS` constant, added `_aod_has_alternative_products()` and `_aod_text_contains_no_offer()` helpers, strengthened `aod_has_offers()` with 5 explicit checks, added Arabic "no offer" phrases, removed `extract_price_main()` function entirely, removed unused `json` import
- uae.py: Removed `extract_price_main` from imports
- egypt.py, germany.py, saudi.py, usa.py: Already correct - they only use `extract_price_aod` with no main page fallback
