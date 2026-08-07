// Browser auth for the Drive transport: the OAuth 2.0 implicit flow, done
// with a redirect and nothing else. No Google script, no library — the
// whole dance is one URL out and one hash back.
//
// The client id belongs to the owner (see docs/drive-setup.md); this module
// only carries it. getToken() returns a cached unexpired token or redirects
// the whole page to Google's consent screen; the return redirect lands back
// on the app with the token in the URL fragment, which captureDriveToken()
// (called first thing at boot) stores and strips before the router ever
// sees it. Tokens last about an hour; expiry simply repeats the redirect,
// and the offline write queue makes the round trip lossless.

import type { DriveTokenProvider } from './drive.ts';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_KEY = 'drive-token';
const STATE_KEY = 'drive-auth-state';
const RETURN_KEY = 'drive-auth-return';

interface StoredToken {
  token: string;
  expiresAt: number;
}

function storedToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredToken>;
    if (typeof value.token !== 'string' || typeof value.expiresAt !== 'number') return null;
    return { token: value.token, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}

/**
 * Pull an access token out of the OAuth return fragment, if this page load
 * is one. Must run before routing: the fragment is Google's, not ours.
 * Returns to the URL the auth flow started from.
 */
export function captureDriveToken(): void {
  if (!location.hash.includes('access_token=')) return;
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('access_token');
  const expiresIn = Number(params.get('expires_in') ?? 3600);
  const state = params.get('state');
  if (!token || !state || state !== sessionStorage.getItem(STATE_KEY)) return;
  sessionStorage.removeItem(STATE_KEY);
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    } satisfies StoredToken),
  );
  const returnTo = sessionStorage.getItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  location.replace(returnTo ?? location.pathname);
}

export class OAuthTokenProvider implements DriveTokenProvider {
  private readonly clientId: string;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  async getToken(): Promise<string> {
    const cached = storedToken();
    // A minute of slack so a token never expires mid-request.
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const state = crypto.randomUUID();
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(RETURN_KEY, location.href);
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: `${location.origin}/`,
      response_type: 'token',
      scope: SCOPE,
      state,
    });
    location.assign(`${AUTH_URL}?${params}`);
    // The page is navigating away; hold callers until it does.
    return new Promise<never>(() => {});
  }

  invalidate(): void {
    localStorage.removeItem(TOKEN_KEY);
  }
}
