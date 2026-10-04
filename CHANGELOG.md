# Changelog

## Unreleased

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
