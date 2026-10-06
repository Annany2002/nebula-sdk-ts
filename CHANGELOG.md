# Changelog

## Unreleased

### Added

- Inspect tables, columns, row counts, creation SQL, and foreign-key relationships through `client.diagrams.get(dbName)` with JWT or scoped API-key authentication.
- Export `SchemaDiagram`, `TableDiagramInfo`, and `ForeignKeyInfo`, preserving SQLite metadata and composite-key column pairs.
- Verify diagram metadata, empty databases, foreign-key actions, and owner/database isolation against the pinned backend and built package consumers.
- Retrieve request telemetry and schema advisor findings through `client.analytics.get(dbName)` using a JWT or scoped API key.
- Export `DatabaseAnalytics`, `ServiceMetrics`, `ServiceMetricBucket`, and `AdvisorIssue` matching the backend's fixed 24-hour report.
- Verify analytics counts, history, advisor findings, and owner/database isolation against the pinned backend and built package consumers.

## 0.4.0 - 2026-10-06

### Added

- Execute SQL through `client.sql.execute(dbName, query)` with JWT or scoped API-key authentication.
- Export `SQLQueryResult` with optional ordered rows/columns, execution metadata, and optional tuple generics.
- Verify SQL reads, writes, empty results, errors, and database isolation against the pinned backend and built package consumers.

## 0.3.0 - 2026-10-06

### Fixed

- Align record list declarations with `{ records, pagination }` and separate create/update acknowledgements from full rows.
- Support text and numeric primary keys, encode ID path segments, and reject empty or unsafe numeric IDs before sending a request.
- Separate schema creation and read responses; expose table row counts and PRAGMA column metadata.
- Separate API-key metadata from one-time creation responses and remove the full key requirement from database listings.
- Correct signup's `user_id`, remove the password field from public user metadata, and type protected health responses.

### Added

- Add optional row generics for record reads, column/table foreign-key types, and support for the backend's legacy `schema` payload alias.
- Verify existing SDK contracts against isolated backend servers and pin CI to backend revision `4bb9912bdc37ec8c199db1298fd77f9dc3f598ba`.
- Document migration from the incorrect 0.2.0 declarations.

## 0.2.0 - 2026-10-04

### Changed

- Raise the minimum supported Node.js version from 18 to 24 and run CI only on Node.js 24 LTS.

### Fixed

- Send the current JWT for account operations and prefer it over an API key for data operations.
- Send no credentials on signup and login, even when the client already has a session or database key.
- Reject JWT-only calls without a session before sending a request.
- Remove the unsupported `X-Nebula-Secret` and manually configured `User-Agent` headers for browser compatibility.
- Keep request deadlines active while reading response bodies and preserve network failure causes.
- Reject malformed JSON and non-JSON success responses instead of returning invalid API data.

### Added

- Add pull request checks for source/test types, lint, formatting, Node.js compatibility, package consumers, and isolated backend integration.
- Create clients without an API key for signup, login, and JWT sessions.
- Validate HTTP(S) backend URLs, credentials, and supported request timeout values.
- Export `ConflictError` for the backend's duplicate-resource and constraint responses.
- Provide isolated authentication integration tests against a local Nebula backend.

Existing API-key clients remain supported. Login still returns a token for callers to set explicitly. Data operations prefer a configured JWT; clear it with `setAuthToken(null)` to use the database key. Response types and additional backend API modules will be aligned in subsequent changes.
