import { NebulaClient } from '../src/client';

/** A real Fetch response so JSON parsing, empty bodies, and headers match runtime behavior. */
export function mockResponse(
  status: number,
  body: unknown = null,
  headers: Record<string, string> = {}
): Response {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function createTestClient(baseURL = 'http://api.nebula-test.com', apiKey = 'neb_testkey') {
  const mockFetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  const client = new NebulaClient({ baseURL, apiKey, fetch: mockFetch, timeout: 5000 });
  return { client, mockFetch };
}

export function getLastRequest(mockFetch: jest.Mock) {
  const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  const url = lastCall[0] as string;
  const init = lastCall[1] as RequestInit;
  return {
    url,
    method: init?.method || 'GET',
    headers: init?.headers as Record<string, string>,
    body: init?.body ? (JSON.parse(init.body as string) as unknown) : undefined,
  };
}
