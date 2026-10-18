/** Public provider discovery never includes OAuth app credentials. */
export interface AuthProvidersResponse {
  providers: { password: boolean; github: boolean };
}

/** BASE64URL(SHA256(verifier)), without padding. Retain the verifier in the initiating client. */
export interface GitHubStartPayload {
  code_challenge: string;
}

/** Explicitly connect GitHub to the owner of the current JWT session. */
export interface GitHubLinkStartPayload extends GitHubStartPayload {
  current_password: string;
}

export interface GitHubAuthorizationResponse {
  authorization_url: string;
  /** Transaction lifetime in seconds, at most ten minutes. */
  expires_in: number;
}

/** Compare state to the initiating attempt and scrub the callback URL before calling. */
export interface GitHubCallbackPayload {
  code: string;
  state: string;
  code_verifier: string;
}

/** Successful linking revokes existing sessions and never returns a new JWT. */
export interface GitHubLinkResponse {
  message: string;
}
