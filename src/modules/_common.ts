import { NebulaClientConfig } from '../types';

/** @internal Client configuration after runtime defaults have been applied. */
export type ResolvedClientConfig = NebulaClientConfig & {
  fetch: typeof globalThis.fetch;
  timeout: number;
};

/** @internal Shared configuration and access to the current JWT session. */
export interface ModuleContext {
  config: ResolvedClientConfig;
  getAuthToken: () => string | null;
}
