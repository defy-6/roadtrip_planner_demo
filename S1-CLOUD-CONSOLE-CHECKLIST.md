# S1 cloud-console read-only acceptance

CloudBase CLI 3.8.6 can verify collection metadata through the read-only
DescribeTables API. Variable names are confirmed by the operator without pulling
their values. Neither check creates, updates, or reads production records.

In the deployed environment, verify in the CloudBase console:

- Collections exist: `users`, `sessions`, `trips`, `trip_members`, `trip_backups`.
- Environment-variable names exist: `AMAP_WEB_SERVICE_KEY`, `QWEATHER_API_KEY`.
- Do not open/export records and do not copy or record either variable's value.
- Record only environment ID, operator, time, and pass/fail for the seven checks.

Acceptance record:

| Field | Result |
| --- | --- |
| Environment ID | `cloud1-d0giwgf98368c9398` |
| Five collections | passed: 2026-10-15, CloudBase DescribeTables, all five present |
| Two variable names | passed: 2026-10-15, user explicitly confirmed both present |
| Data or settings changed | no |

The environmental checklist is complete. This does not claim a production
restore drill, multi-instance stress test, or full security audit was performed.
