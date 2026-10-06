// test/client.test.ts
import { NebulaClient } from '../src/client';
import { NebulaError } from '../src/errors';
import { NebulaClientConfig } from '../src/types';

const validConfig = {
  baseURL: 'http://mock-nebula.com',
  apiKey: 'neb_testkey123',
};

describe('NebulaClient Initialization', () => {
  it('should initialize successfully with valid config', () => {
    const client = new NebulaClient(validConfig);
    expect(client).toBeInstanceOf(NebulaClient);
    const config = client.getConfig();
    expect(config.baseURL).toBe(validConfig.baseURL);
    expect(config.apiKey).toBe(validConfig.apiKey);
    expect(config.timeout).toBeDefined();
  });

  it('should throw NebulaError if baseURL is missing', () => {
    expect(() => new NebulaClient(undefined as unknown as NebulaClientConfig)).toThrow(NebulaError);
    expect(() => new NebulaClient({} as NebulaClientConfig)).toThrow(NebulaError);
    expect(() => new NebulaClient({ apiKey: 'neb_key' } as NebulaClientConfig)).toThrow(
      NebulaError
    );
  });

  it('allows initialization without an API key for signup and JWT sessions', () => {
    const client = new NebulaClient({ baseURL: 'http://test.com' });
    expect(client.getConfig().apiKey).toBeUndefined();
  });

  it('should throw NebulaError if baseURL is invalid', () => {
    expect(() => new NebulaClient({ ...validConfig, baseURL: 'invalid' })).toThrow(
      /Invalid baseURL/
    );
  });

  it('should allow setting and getting auth token', () => {
    const client = new NebulaClient(validConfig);
    expect(client.getAuthToken()).toBeNull();
    client.setAuthToken('my.jwt.token');
    expect(client.getAuthToken()).toBe('my.jwt.token');
    client.setAuthToken(null);
    expect(client.getAuthToken()).toBeNull();
  });

  it('should expose modules on the client instance', () => {
    const client = new NebulaClient(validConfig);
    expect(client.auth).toBeDefined();
    expect(client.databases).toBeDefined();
    expect(client.schema).toBeDefined();
    expect(client.records).toBeDefined();
    expect(client.sql).toBeDefined();
    expect(client.analytics).toBeDefined();
    expect(client.diagrams).toBeDefined();
  });

  it('should apply default timeout of 30000ms', () => {
    const client = new NebulaClient(validConfig);
    expect(client.getConfig().timeout).toBe(30000);
  });

  it('should allow custom timeout', () => {
    const client = new NebulaClient({ ...validConfig, timeout: 5000 });
    expect(client.getConfig().timeout).toBe(5000);
  });
});

const invalidURLs = [
  'ftp://example.com',
  'file:///private/data',
  'https://user:password@example.com',
  'https://example.com?query=1',
  'https://example.com#fragment',
];
test.each(invalidURLs)('rejects unsafe or ambiguous baseURL %s', (baseURL) => {
  expect(() => new NebulaClient({ baseURL })).toThrow(NebulaError);
});
test.each([0, -1, NaN, Infinity, 1.5, 2_147_483_648])('rejects invalid timeout %s', (timeout) => {
  expect(() => new NebulaClient({ ...validConfig, timeout })).toThrow(/timeout/);
});
test.each(['', 'key with spaces', 'key\r\ninjected'])('rejects invalid API key %j', (apiKey) => {
  expect(() => new NebulaClient({ ...validConfig, apiKey })).toThrow(/apiKey/);
});
test.each(['', 'token with spaces', 'token\nheader'])('rejects invalid JWT %j', (token) => {
  const client = new NebulaClient(validConfig);
  client.setAuthToken('valid.jwt');
  expect(() => client.setAuthToken(token)).toThrow(/authToken/);
  expect(client.getAuthToken()).toBe('valid.jwt');
});
