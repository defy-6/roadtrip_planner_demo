# Data access policy

## Classification

| Source | Class | Automated development access |
| --- | --- | --- |
| `tests/`, `work/`, local `data/` | sample | allowed; local content is test data only |
| Cloud database and cloud backups | confidential | denied; production records stay user-controlled |
| Cloud environment-variable values | confidential | denied; never print, copy, or commit them |
| Sanitized counts/status reports | safe-derived | allowed when they contain no record values or secrets |

Classification applies recursively. Development and tests must not fall back to the
production cloud when a fixture is missing. Production checks may report collection
names, existence, counts, schema status, and pass/fail results, but not records,
tokens, addresses, environment-variable values, or raw exception payloads.

Cloud deployment and production validation remain user-controlled. `.gitignore` is
not an access-control mechanism.
