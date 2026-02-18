// test/test-helpers.ts
// Shared utilities for test suites -- creates a mock fetch and NebulaClient

import { NebulaClient } from '../src/client';

/**
 * Creates a mock Response object matching the Fetch API.
 */
export function mockResponse(status: number, body: any = null, headers: Record<string, string> = {}): Response {
    const isNull = body === null || body === undefined;
    const bodyStr = isNull ? '' : JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: '',
        headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
        json: async () => body,
        text: async () => bodyStr,
        clone: () => mockResponse(status, body, headers),
        body: null,
        bodyUsed: false,
        arrayBuffer: async () => new ArrayBuffer(0),
        blob: async () => new Blob(),
        formData: async () => new FormData(),
        redirected: false,
        type: 'basic' as ResponseType,
        url: '',
        bytes: async () => new Uint8Array(),
    } as Response;
}

/**
 * Creates a mock fetch function and a NebulaClient configured to use it.
 * Returns both so tests can configure mock responses and make assertions.
 */
export function createTestClient(baseURL = 'http://api.nebula-test.com', apiKey = 'neb_testkey') {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();
    const client = new NebulaClient({
        baseURL,
        apiKey,
        fetch: mockFetch as any,
        timeout: 5000,
    });
    return { client, mockFetch };
}

/**
 * Extracts the request details from a mockFetch call for assertion.
 */
export function getLastRequest(mockFetch: jest.Mock) {
    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const url = lastCall[0] as string;
    const init = lastCall[1] as RequestInit;
    return {
        url,
        method: init?.method || 'GET',
        headers: init?.headers as Record<string, string>,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
}
