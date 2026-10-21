# V1 → V2 feature parity checklist

Reference: original CRM (read-only, not accessed or modified). Status: Done / Partial / Todo. "Backend" = UI + contract only, real service pending for Antigravity.

## Batch 1 — Advanced Lead Management (Done)
- [x] Bulk lead entry with review (rule-based demo reader; real AI extraction = Backend)
- [x] Duplicate detection (existing + within batch), safe merge (fill empty fields) or update existing
- [x] Waste leads with reason + restore (restores follow-ups and history)
- [x] Recently Deleted + restore, permanent delete, empty, Undo toast
- [x] Pinned leads (existing) + stale detection (7+ quiet days, no upcoming follow-up)
- [x] Quick statuses separate from pipeline stage, filterable
- [x] Activity history logs merge, waste, restore, quick status, stage, calls, payments

## Batch 2 — Smart Sales Workflows (Next)
- [ ] Smart follow-up recommendations · [ ] duplicate/conflicting follow-up prevention · [ ] call outcome history + Undo · [x] Call Log popup (keep)

## Batch 3 — WhatsApp tools · Batch 4 — AI features (Backend for real AI) · Batch 5 — Deals lifecycle, payment editing, client rankings · Batch 6 — Notification center, push UI, CSV/Excel export, global undo, CRM Guide
