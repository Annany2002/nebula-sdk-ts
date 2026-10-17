import { NebulaClientConfig } from '../types';
import { ManagementRequestOptions } from '../types/account';
import { RequestContext } from '../http';
import { authOptions } from './auth-validation';

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

/** @internal API keys must never replace a missing JWT for account/admin operations. */
export function bearerContext(
  context: ModuleContext,
  options: ManagementRequestOptions
): RequestContext {
  const { timeout, signal } = authOptions(options);
  return {
    ...context.config,
    timeout: timeout ?? context.config.timeout,
    signal,
    authToken: context.getAuthToken(),
    authentication: 'bearer',
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  };
}
