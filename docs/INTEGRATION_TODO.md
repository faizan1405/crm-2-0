# Independent Antigravity backend handoff

Ready as a reviewed **local frontend baseline**, not a production application.

1. Create the new project's own repository and backend/environment; never use the protected original CRM repository, Neon database or deployment. No separate user-facing GitHub repository is connected by this task.
2. Choose the actual server architecture deliberately: this frontend uses TanStack Start, not the original CRM's Next.js. Retain TanStack routing unless a separately planned migration is approved.
3. Add authentication and ownership/workspace fields, sign-in/out/recovery, session handling, role/permission policy, route guards and server-side authorization for every operation. Disabled security controls must become real flows, not cosmetic toggles.
4. Replace the Zustand action/data boundary with an adapter to independent persistence. Add authenticated queries, errors/loading/retry, pagination, optimistic rollback/conflict resolution and transactional linked-record updates. Keep pure finance/date/validation tests.
5. Enforce cumulative overpayment protection atomically; add payment idempotency, immutable audit records, void permissions, safe currency precision and define cancellation/refund/end-of-due-day policies. Do not silently cap received money from corrupt/overpaid imports.
6. Agree duplicate phone policy, explicit overrides and lead archive/delete behavior for linked deals. Add trusted server validation; browser checks are not security.
7. Replace demo parser/scoring/rule-summary labels only after a real AI service exists. Preserve editable confirmation, missing/ambiguous-field handling, data minimization and error handling.
8. Implement reminder scheduling, timezone policies, notification delivery/preferences, email/push consent, retries and digest jobs. Saved demo notification choices currently send nothing.
9. Provide deployment secrets, production tests, backup/restore, monitoring, security review and accessibility audit before release.

No backend, authentication service, AI service or notification delivery was configured during Phase 2.5. Production remains untouched. Browser-only data must not be described as database persistence.