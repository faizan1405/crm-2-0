# ESLint & Line-Ending Baseline — Checkpoint B1A

Recorded on branch `feat/b1a-backend-foundation` without mass-formatting pre-existing Lovable frontend code.

## 1. Controlled Line-Ending Policy (`.gitattributes`)
B0 observed ~30,029 ESLint errors on Windows primarily caused by Git checking out LF repository blobs as CRLF (`prettier/prettier` `Delete ␍`) plus a phantom modified `src/routeTree.gen.ts`.

To eliminate Windows/Linux line-ending churn without touching existing frontend source files:
- Added [`.gitattributes`](../.gitattributes) pinning `* text=auto eol=lf`, explicit `eol=lf` for `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.json`, `.css`, `.html`, `.md`, `.yml`, `.yaml`, explicit `eol=crlf` for `.bat`, `.cmd`, `.ps1`, and `binary` for archives/fonts/media.
- Aligned working-tree text line endings locally to match the Git index (`eol=lf`) and cleared the phantom `src/routeTree.gen.ts` stat diff.
- Result: CRLF noise dropped from ~30,029 ESLint errors down to **9,105** total (`27` non-Prettier errors + `9,078` pre-existing `.prettierrc` formatting style differences across untouched Lovable files — eliminating ~20,924 CRLF errors with zero code churn).

## 2. Recorded Non-Prettier ESLint Baseline (27 Errors, 41 Warnings)
Command run: `eslint . --rule "prettier/prettier: off"`

### Summary
- **B1A files (`src/server/**`, `src/server.ts`, `vite.config.ts`, `drizzle.config.ts`, `src/test/data-vault-proof.b1a.test.ts`):** **0 errors, 0 warnings** (including Prettier checks).
- **Pre-existing codebase baseline (preserved untouched per B1A scope):** **27 non-Prettier errors**, **41 warnings**.

### Non-Test Source Files (4 errors — verified NOT runtime or security defects)
1. `src/lib/ai/projectAssist.ts:91:48` — `no-misleading-character-class` (`/^[A-Z\u0900-\u097F]/` Devanagari range regex works as intended).
2. `src/lib/crm/customize.ts:144:90` — `@typescript-eslint/no-unused-expressions` (conditional side-effect ternary).
3. `src/lib/crm/docExtract.ts:199:98` — `no-control-regex` (intentional `/[\u0000\uFFFD]/g` sanitizer for malformed PDF font maps).
4. `src/routes/automation.tsx:148:94` — `react-hooks/rules-of-hooks` (plain callback handler named `useTemplate(templateId)`, not a React Hook).

### Pre-Existing Test Files (23 `@typescript-eslint/no-explicit-any` errors)
- `src/lib/crm/crossTab.d221.test.ts` — 1 error (line 9)
- `src/lib/crm/crossTab.d222a.test.ts` — 1 error (line 12)
- `src/lib/crm/crossTab.d222b.test.ts` — 13 errors (lines 12, 17×2, 30, 33, 40, 51, 62, 68×2, 75, 79, 80)
- `src/lib/crm/crossTab.d32.test.ts` — 4 errors (lines 12, 17×2, 18)
- `src/lib/crm/quotation.d33.test.ts` — 4 errors (lines 10, 20, 23, 24)

### Warnings Baseline (41 pre-existing warnings)
- `react-refresh/only-export-components` helper exports across UI/component files.
- `react-hooks/exhaustive-deps` in pre-existing page components (`analytics.tsx`, `inbox.tsx`, `leads.tsx`, `pipeline.tsx`).
