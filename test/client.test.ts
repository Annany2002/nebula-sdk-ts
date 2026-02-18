// test/client.test.ts
import { NebulaClient } from '../src/client';
import { NebulaError } from '../src/errors';

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
    expect(() => new NebulaClient(undefined as any)).toThrow(NebulaError);
    expect(() => new NebulaClient({} as any)).toThrow(NebulaError);
    expect(() => new NebulaClient({ apiKey: 'neb_key' } as any)).toThrow(NebulaError);
  });

  it('should throw NebulaError if apiKey is missing', () => {
    expect(() => new NebulaClient({ baseURL: 'http://test.com' } as any)).toThrow(NebulaError);
  });

  it('should throw NebulaError if baseURL is invalid', () => {
    expect(() => new NebulaClient({ ...validConfig, baseURL: 'invalid' })).toThrow(/Invalid baseURL/);
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
