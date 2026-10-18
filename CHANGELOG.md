# Changelog

## Unreleased

### Added

- Public provider discovery and separate GitHub sign-in/linking methods with typed payloads, bounded S256 proof validation, safe authorization URL checks and projected responses.
- OAuth contract tests, installed JavaScript/TypeScript package checks and a Go-backend integration suite included in the default CI checks with an injected provider and disposable SQLite data.

GitHub support requires backend revision `10efe63ba1c07a9fe0588318227f3f228a79961b` or later and a configured OAuth app. It is not included in npm version 0.13.0. CI pins this backend revision and includes OAuth integration in the default suite.

## 0.13.0 - 2026-10-18

### Added

- Public password-recovery requests and explicit password replacement through `auth.forgotPassword()` and `auth.resetPassword()`, with validated payloads, cancellation, total deadlines and no automatic retries.
- Recovery contract, fresh-package type coverage and isolated backend recovery tests with captured mail, included in the default integration command and CI.

Requires backend revision `2a94edf32cffc702168b07616613414227e1e165` or later and configured SMTP with `PASSWORD_RESET_ENABLED=true`.

## 0.12.0 - 2026-10-17

### Added

- Owner-JWT `account.getSummary()` and platform-admin `admin.listUsers()`, `getUser()`, `getStats()`, `suspendUser()`, `activateUser()` and `listAuditEvents()`, with typed filters, pagination, cancellation and deadlines.
- Optional current profile roles, safe response projection, strict metadata/identity/completeness checks, and local validation of administrator filters.
- Unit tests, installed JavaScript/TypeScript consumer checks and isolated management integration using the operator CLI only on disposable data.

### Changed

- `auth.getMe()` validates the documented profile fields and preserves optional membership without adding a role to login responses or assuming a role for older servers.

The new endpoints require backend revision `0449778897e971ce48f712b5913f6deb14bcb5b1` or later. CI pins this revision and includes management in the default integration suite.

## 0.11.0 - 2026-10-17

### Added

- Explicit email verification, generic resend acknowledgement and password-confirmed email changes through `auth.verifyEmail()`, `auth.resendVerification()` and `auth.requestEmailChange()`.
- Optional account verification/delivery metadata, request cancellation/deadlines and `RateLimitError.retryAfterSeconds`, preserving server machine codes without automatic retries or session changes.
- Verification contract tests, isolated Go-backend integration with captured mail, and installed JavaScript/TypeScript package checks.

### Changed

- Email-capable `auth.updateProfile()` calls return an updated user or a pending-email acknowledgement. Narrow with `'pending_email' in result` before reading `result.user`; username-only updates retain their existing response type.
- Auth requests omit browser credentials, disable caching and reject redirects. Signup and email-change acknowledgements are checked before being returned to callers; legacy registration and immediate-update responses remain supported.

The new verification endpoints require backend revision `df3db62cfff1da463294e46550e1d6688304fbb5` or later. CI pins this revision and includes verification integration in the default backend contract suite.

## 0.10.0 - 2026-10-10

### Added

- Owner-JWT managed backups with `client.backups.create()`, `list()`, `get()`, `download()`, `restore()` and `delete()`.
- Typed metadata, pagination, cancellation and request deadlines; explicit UUID creation intents and no automatic write retries.
- Bounded downloads verified against saved size, SQLite header and SHA-256; preserve machine-readable server error codes.
- Failure-case unit tests, packed consumer checks and backend backup integration covering native snapshots, object/sequence restoration, empty databases, owner isolation, deleted sources and UUID tombstones.

### Changed

- Pin backend CI to managed-backup revision `ecede100d8747a53405364bcf14d00759f92a545` and include backups in the default integration suite.

Managed backups require this backend revision or later and an owner JWT. Downloads require Web Crypto in Node.js 24 or a secure browser context. This release adds manual local-disk backups; scheduling, automatic retention and remote storage are not included.

## 0.9.0 - 2026-10-08

### Added

- Import standalone SQLite snapshots into new databases with `client.databases.importSQLite()`, using an owner JWT and browser `File`/`Blob` or `Uint8Array`/Node `Buffer` inputs.
- Export typed import payloads, acknowledgements and options for cancellation and per-import timeouts. Validate destination names, snapshot sizes and headers without automatic write retries.
- Add `RequestAbortedError` for caller cancellation, preserving shared authentication, HTTP errors, response-body deadlines and cleanup across multipart requests.
- Verify multipart bytes, cancelled/unconfirmed uploads, independent owner databases, export/import round-trips, native database objects and packaged consumers.

### Changed

- Pin backend integration checks to SQLite import revision `a21cd7d3ba5670b475cb2a7ac9443fca20c64a59` and include imports in the default integration suite.

SQLite import requires this backend revision or later.

## 0.8.0 - 2026-10-07

### Added

- Create and drop table triggers with `client.objects.createTrigger()` and `client.objects.dropTrigger()`, using owner JWTs or scoped API keys.
- Export trigger event/timing unions and typed creation payloads, canonical metadata, and deletion acknowledgements. Support BEFORE/AFTER events, optional conditions, and UPDATE OF columns.
- Validate input shapes and SQL text byte limits; preserve SQL text and use existing error/authentication handling without write retries.
- Verify real trigger execution, validation rollback, tenant isolation, preserved records after deletion, and packed JavaScript/TypeScript consumers.

### Changed

- Pin backend integration checks to trigger-management revision `264e53b2e72f4a4718f8a50d418ec14c525216f3`.

Native trigger methods require this backend revision or later.

## 0.7.0 - 2026-10-06

### Added

- Create and drop ordinary or unique column indexes with `client.objects.createIndex()` and `client.objects.dropIndex()`, using JWT or scoped API-key authentication.
- Export `CreateIndexPayload`, `CreateIndexResponse`, and `DropIndexResponse`, preserving composite column order and canonical SQLite metadata.
- Verify conflict handling, constraint enforcement/removal, quoted names, protected objects, owner isolation, no retries, and packed JavaScript/TypeScript consumers.

### Changed

- Pin backend integration checks to index-management revision `3b7115917fc5876c1ee0e9add7a5cb902eadf142`.

## 0.6.0 - 2026-10-06

### Added

- Alter table schemas through `client.schema.alterTable(dbName, tableName, payload)` with add/drop columns, column/table renames, foreign-key definitions, SQL defaults, and ordered transactional batches.
- Export `AlterColumnDefinition`, `AlterTableOperation`, `AlterTablePayload`, and `AlterTableResponse`, including nullable post-commit schema metadata.
- Verify live schema changes, batch rollback, creation metadata, tenant isolation, authentication, and packed JavaScript/TypeScript consumers.
- Inspect database metadata, table and record counts, file sizes, and optional API-key prefixes through `client.databases.get(dbName)` using a JWT or scoped API key.
- Export `DatabaseDetails` and `DatabaseDetailsResponse` matching the backend envelope without exposing API-key secrets.
- Verify live counts, empty databases, quoted table names, owner isolation, and package consumers.

### Changed

- Pin integration checks to backend revision `4e86a8d072df4d842747d0a19211bf0c29ccc3d5`, which counts records in quoted SQLite tables correctly.

## 0.5.0 - 2026-10-06

### Added

- Export SQL dumps through `client.exports.sql(dbName)` and buffered standalone SQLite snapshots through `client.exports.sqlite(dbName)` using a JWT or scoped API key.
- Export `SQLExport` and `SQLiteExport` types, preserving SQL text and binary bytes without writing files or triggering browser downloads.
- Verify export restoration, SQLite data types and dependent objects, database isolation, binary body deadlines, and built package consumers.
- Inspect custom indexes and triggers through `client.objects.get(dbName)` with JWT or scoped API-key authentication.
- Export `DatabaseObjects`, `IndexInfo`, and `TriggerInfo` for the read-only catalog; object creation and removal continue to use SQL execution.
- Verify index use, uniqueness constraints, trigger execution, SQL-based removal, and owner/database isolation against the backend and built package consumers.
- Inspect tables, columns, row counts, creation SQL, and foreign-key relationships through `client.diagrams.get(dbName)` with JWT or scoped API-key authentication.
- Export `SchemaDiagram`, `TableDiagramInfo`, and `ForeignKeyInfo`, preserving SQLite metadata and composite-key column pairs.
- Verify diagram metadata, empty databases, foreign-key actions, and owner/database isolation against the pinned backend and built package consumers.
- Retrieve request telemetry and schema advisor findings through `client.analytics.get(dbName)` using a JWT or scoped API key.
- Export `DatabaseAnalytics`, `ServiceMetrics`, `ServiceMetricBucket`, and `AdvisorIssue` matching the backend's fixed 24-hour report.
- Verify analytics counts, history, advisor findings, and owner/database isolation against the pinned backend and built package consumers.

### Changed

- Share authentication, error mapping, and complete body-read deadlines between JSON and binary HTTP requests.
- Pin integration checks to backend revision `e714059ca8c5ac72848a902b5edab325ade2cc26`, which reads index uniqueness from SQLite metadata instead of SQL text.

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
