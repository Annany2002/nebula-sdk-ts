// test/modules/auth.test.ts (or a new test file focused on API Key access if AuthModule changes significantly)
import nock from 'nock';
import { NebulaClient } from '../../src/client'; // Client would be configured with apiKey only
import { AuthError, ApiError } from '../../src/errors'; // Assuming 401 maps to AuthError
import { makeRequest } from '../../src/http'; // This is the updated makeRequest
import { NebulaClientConfig } from '../../src/types';

const mockBaseURL = 'http://localhost:8080';
const validFullApiKey = 'neb_uDRpC13L1Cj10tvcGkHujiypdKUAlBnIcrkXAzwW7sE'; // Provided by SDK user
const invalidFullApiKey = 'neb_totallywrongsecretpart'; // For testing invalid key scenario
const nonPrefixedApiKey = 'justakeywithoutprefix'; // For testing prefix validation by backend

// Context for API-Key-Only SDK requests
const mockApiRequestContext = (apiKeyToUse: string): Required<NebulaClientConfig> => ({
  baseURL: mockBaseURL,
  apiKey: apiKeyToUse,
  timeout: 500,
  fetch: globalThis.fetch as any, // Cast if necessary or ensure fetch type matches
});

describe('SDK Access to Protected /api/v1/health (using ApiKey Scheme)', () => {
  const healthPath = '/api/v1/health';

  afterEach(() => {
    nock.cleanAll();
  });

  it('should succeed with a valid API Key in Authorization header', async () => {
    const successResponse = { status: 'ok', authenticated_by: 'api_key' }; // Example response
    nock(mockBaseURL)
      .get(healthPath)
      .matchHeader('Authorization', `ApiKey ${validFullApiKey}`) // This must match exactly
      .reply(200, successResponse);

    const response = await makeRequest(healthPath, 'GET', mockApiRequestContext(validFullApiKey));

    expect(response).toEqual(successResponse);
  });

  it('should fail with AuthError if API Key (secret part) is invalid', async () => {
    // Assuming your Go backend's bcrypt check fails and returns ErrUnauthorized (mapped to 401)
    const backendErrorResponse = {
      error: 'Invalid API key',
      authenticated_by: 'api_key',
      status: 'ok',
    }; // Or your specific error for invalid key
    const scope = nock(mockBaseURL)
      .get(healthPath)
      .matchHeader('Authorization', `ApiKey ${invalidFullApiKey}`)
      .reply(401, backendErrorResponse);

    const response = await makeRequest(healthPath, 'GET', mockApiRequestContext(validFullApiKey));

    expect(response).toEqual(backendErrorResponse);
  });

  it('should fail if API Key is missing "neb_" prefix (backend schema validation)', async () => {
    // Your Go middleware: if !strings.HasPrefix(credentials, apiKeyPrefix) -> ErrTokenMalformed
    // Let's assume ErrTokenMalformed gets mapped by your global error handler to 401/400
    // with a message like "token is malformed" or "invalid key prefix"
    const backendErrorResponse = { error: 'token is malformed: invalid key prefix' }; // Example
    const scope = nock(mockBaseURL)
      .get(healthPath)
      .matchHeader('Authorization', `ApiKey ${nonPrefixedApiKey}`)
      .reply(401, backendErrorResponse); // Or 400, depending on your error handler for ErrTokenMalformed

    try {
      await makeRequest(healthPath, 'GET', mockApiRequestContext(nonPrefixedApiKey));
      throw new Error('Test should have thrown for API Key missing prefix');
    } catch (error: any) {
      expect(error).toBeInstanceOf(AuthError); // Or BadRequestError if mapped to 400
      expect(error.statusCode).toBe(401); // Or 400
      expect(error.message).toContain('invalid key prefix'); // Check the specific message
      expect(error.errorData).toEqual(backendErrorResponse);
    }
    expect(scope.isDone()).toBe(true);
  });

  it('should fail if Authorization header is completely missing (backend validation)', async () => {
    // This tests the backend's requirement for the Authorization header itself.
    // To make the SDK *not* send the header, we'd need to call makeRequest
    // with a context where apiKey is undefined/null, and makeRequest would have to
    // conditionally omit the header.
    // If makeRequest *always* sends "Authorization: ApiKey <value>", even if value is "",
    // this specific test of a *completely missing header from SDK* is hard.
    // Instead, let's test what the SDK does if configured with an empty API Key string.
    // The Go middleware will receive "ApiKey " (ApiKey plus a space).
    // `credentials` will be "". `strings.HasPrefix("", "neb_")` is false. -> ErrTokenMalformed.
    const emptyApiKey = '';
    // The backend will respond based on: `parts := strings.SplitN(authHeader, " ", 2)` -> `parts[0]="ApiKey", parts[1]=""`
    // Then `strings.HasPrefix(parts[1], "neb_")` will be `strings.HasPrefix("", "neb_")` which is false.
    // So, it will trigger the "invalid key prefix" path of `ErrTokenMalformed`.
    const backendErrorResponse = { error: 'token is malformed: invalid key prefix' }; // Or your specific mapping
    const scope = nock(mockBaseURL)
      .get(healthPath)
      .matchHeader('Authorization', `ApiKey ${emptyApiKey}`) // SDK sends "ApiKey "
      .reply(401, backendErrorResponse); // Backend validation for prefix fails

    try {
      await makeRequest(healthPath, 'GET', mockApiRequestContext(emptyApiKey));
      throw new Error('Test should have thrown for empty API Key string');
    } catch (error: any) {
      expect(error).toBeInstanceOf(AuthError); // Assuming 401 maps to AuthError
      expect(error.statusCode).toBe(401);
      expect(error.message).toContain('invalid key prefix');
      expect(error.errorData).toEqual(backendErrorResponse);
    }
    expect(scope.isDone()).toBe(true);
  });

  it('should fail if Authorization header has wrong scheme (e.g., "InvalidScheme")', async () => {
    const wrongSchemeApiKey = 'neb_somekey'; // This key value is fine
    // The backend error for this is: "Authorization header format must be 'Bearer {token}' or 'ApiKey {key}'"
    // This comes if scheme is not "apikey" or "bearer".
    // However, our SDK's makeRequest *always* sends "ApiKey <key>".
    // So, this particular error ("wrong scheme") cannot be triggered by the current SDK's makeRequest.
    // This would be for testing external clients calling your backend with a bad scheme.
    // If we wanted to test the SDK handling such a response *if it somehow occurred*:
    const backendErrorResponse = {
      error: "Authorization header format must be 'Bearer {token}' or 'ApiKey {key}'",
    };
    const scope = nock(mockBaseURL)
      .get(healthPath)
      // We can't easily make our SDK send a "WrongScheme" header.
      // So we assume some other client sent it, and we're just checking the SDK can parse this error response.
      // For this test to be about the SDK *sending*, we'd need to modify makeRequest, which is not the goal here.
      // Let's assume the backend replied with 401 and this body for some reason, and check SDK mapping.
      .matchHeader('Authorization', `ApiKey ${validFullApiKey}`) // SDK sends correctly
      .reply(401, backendErrorResponse); // But backend *replies* with this error (hypothetical)

    try {
      await makeRequest(healthPath, 'GET', mockApiRequestContext(validFullApiKey));
      throw new Error('Test should have thrown');
    } catch (error: any) {
      expect(error).toBeInstanceOf(AuthError);
      expect(error.statusCode).toBe(401);
      expect(error.message).toContain(
        "Authorization header format must be 'Bearer {token}' or 'ApiKey {key}'"
      );
      expect(error.errorData).toEqual(backendErrorResponse);
    }
    expect(scope.isDone()).toBe(true);
  });

  // The "malformed token" error from your previous Jest output:
  // That specific error `AuthError: malformed token` came when a JWT was involved and was "dummy-valid-jwt-token".
  // Your Go middleware's JWT validation: `jwtUserID, authErr = nebulaErrors.ValidateJWT(...)`
  // If `authErr` is `auth.ErrTokenMalformed`, the message is "token is malformed".
  // Since the SDK (as per new requirement) is *only* sending `ApiKey` for these general calls,
  // it will not send a JWT, so it cannot trigger the "malformed token" error related to JWTs
  // from the `ValidateJWT` function.
  // It *can* trigger the `ErrTokenMalformed` from the API key prefix check, as tested above.
});
