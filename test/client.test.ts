// test/client.test.ts
import { NebulaClient } from '../src/client';
import { NebulaClientConfig } from '../src/types';
import { NebulaError } from '../src/errors';

const mockConfig: NebulaClientConfig = {
  baseURL: 'http://mock-nebula.com',
};

describe('NebulaClient Initialization', () => {
  it('should initialize successfully with valid config', () => {
    const client = new NebulaClient(mockConfig);
    expect(client).toBeInstanceOf(NebulaClient);
    // Check if config is stored (excluding fetch)
    const internalConfig = client.getConfig();
    expect(internalConfig.baseURL).toBe(mockConfig.baseURL);
    expect(internalConfig.timeout).toBeDefined(); // Check default timeout
  });

  it('should throw NebulaError if baseURL is missing', () => {
    expect(() => new NebulaClient(undefined as any)).toThrow(NebulaError);
    expect(() => new NebulaClient({} as any)).toThrow(NebulaError);
    expect(() => new NebulaClient({ timeout: 1000 } as any)).toThrow(/baseURL in configuration/);
  });

  it('should throw NebulaError if baseURL is invalid', () => {
    expect(() => new NebulaClient({ baseURL: 'invalid-url' })).toThrow(/Invalid baseURL/);
    expect(() => new NebulaClient({ baseURL: 'http://' })).toThrow(/Invalid baseURL/); // Hostname needed
  });

  it('should allow setting and getting auth token', () => {
    const client = new NebulaClient(mockConfig);
    expect(client.getAuthToken()).toBeNull();

    const testToken = 'dummy.jwt.token';
    client.setAuthToken(testToken);
    expect(client.getAuthToken()).toBe(testToken);

    client.setAuthToken(null);
    expect(client.getAuthToken()).toBeNull();
  });

  // Add more tests later for default timeout, custom fetch, etc.
});

// We will add tests for http.ts and module interactions later
