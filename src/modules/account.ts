import { makeRequest } from '../http';
import { AccountSummaryResponse, ManagementRequestOptions } from '../types';
import { bearerContext, ModuleContext } from './_common';
import { parseAccountSummary } from './management-validation';

export class AccountModule {
  constructor(private readonly context: ModuleContext) {}

  /** Counts only the signed-in owner's metadata, including when that owner is an administrator. */
  async getSummary(options: ManagementRequestOptions = {}): Promise<AccountSummaryResponse> {
    return makeRequest(
      'api/v1/account/summary',
      'GET',
      bearerContext(this.context, options),
      undefined,
      undefined,
      [200],
      parseAccountSummary
    );
  }
}
