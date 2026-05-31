# Task 1 - Agent: full-stack-developer

## Task: Rewrite Amazon AOD Crawler to use agent-browser

### Summary
Rewrote the Amazon AOD price crawler to use `agent-browser` CLI for real browser-based price extraction, replacing the non-existent script approach and the z-ai-web-dev-sdk page_reader.

### Files Modified

1. **`/home/z/my-project/src/lib/browser-crawler.ts`** — Complete rewrite
   - Primary method: `agent-browser eval` for direct DOM price extraction
   - Fallback method: `agent-browser snapshot` JSON parsing
   - Eval scripts for price, name, image, and no-offer detection
   - Arabic numeral conversion support (٠-٩ → 0-9, ٫ → .)
   - German/European price format handling (9,49 €)
   - AOD-only enforcement: only #aod-pinned-offer and #aod-offer-list
   - Flow: close → open homepage → set cookies → open AOD → wait → eval → snapshot fallback → close

2. **`/home/z/my-project/src/app/api/crawl/route.ts`** — Rewritten
   - Removed scripts/crawl-aod.js subprocess spawning
   - Calls `crawlRegion()` from browser-crawler sequentially per region
   - Kept two modes (crawl + save) and DB upsert logic

3. **`/home/z/my-project/src/lib/aod-crawler.ts`** — Simplified
   - Now re-exports types and functions from browser-crawler.ts

### Verification
- `bun run lint`: No errors in modified files
- Dev server running on port 3000
- No changes to Prisma schema, page.tsx, or other API routes
