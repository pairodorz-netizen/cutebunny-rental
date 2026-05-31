import { Hono } from 'hono';
import * as jose from 'jose';
import { sign, verify } from 'hono/jwt';
import { getDb } from '../lib/db';
import { getEnv } from '../lib/env';
import { error } from '../lib/response';
import { syncLineIdentity } from '../lib/identity/sync-email-identity';

const lineAuth = new Hono();

/** LINE Login env helpers */
function getLineConfig() {
  const env = getEnv();
  return {
    channelId: env.LINE_LOGIN_CHANNEL_ID ?? '',
    channelSecret: env.LINE_LOGIN_CHANNEL_SECRET ?? '',
    callbackUrl: env.LINE_LOGIN_CALLBACK_URL ?? '',
    appBaseUrl: env.APP_BASE_URL ?? 'http://localhost:3000',
    featureEnabled: env.FEATURE_LINE_LOGIN === 'on',
  };
}

function getJwtSecret(): string {
  return getEnv().JWT_SECRET || 'dev-secret-change-in-production';
}

async function createCustomerToken(customerId: string, email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await sign({
    sub: customerId,
    email,
    type: 'customer',
    iat: now,
    exp: now + 30 * 24 * 3600,
  }, getJwtSecret());
}

/** Generate cryptographically random string */
function randomState(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Encode state payload into a signed JWT (short-lived, 10min) */
async function encodeStateCookie(payload: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await sign({
    ...payload,
    iat: now,
    exp: now + 600, // 10 minutes
  }, getJwtSecret());
}

/** Decode and verify state cookie */
async function decodeStateCookie(token: string): Promise<Record<string, unknown> | null> {
  try {
    const decoded = await verify(token, getJwtSecret(), 'HS256');
    return decoded as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * GET /line/start
 * Redirects to LINE Login authorize URL.
 * Query params: ?intent=<base64 JSON>, ?link=1
 */
lineAuth.get('/start', async (c) => {
  const config = getLineConfig();
  if (!config.featureEnabled) {
    return error(c, 404, 'NOT_FOUND', 'LINE Login is not enabled');
  }
  if (!config.channelId || !config.channelSecret) {
    return error(c, 500, 'CONFIG_ERROR', 'LINE Login not configured');
  }

  const intent = c.req.query('intent') ?? '';
  const link = c.req.query('link') === '1';

  // If link mode, verify the user is already authenticated
  let authUserId: string | undefined;
  if (link) {
    const cookieHeader = c.req.header('Cookie') ?? '';
    const tokenMatch = cookieHeader.match(/cb_customer_token=([^;]+)/);
    if (!tokenMatch) {
      return redirectWithError(config.appBaseUrl, 'Must be signed in to link accounts');
    }
    try {
      const decoded = await verify(tokenMatch[1], getJwtSecret(), 'HS256');
      if (decoded.type !== 'customer') {
        return redirectWithError(config.appBaseUrl, 'Invalid token');
      }
      authUserId = decoded.sub as string;
    } catch {
      return redirectWithError(config.appBaseUrl, 'Invalid or expired token');
    }
  }

  const state = randomState();
  const nonce = randomState();

  // Store state+nonce in a signed cookie
  const stateCookie = await encodeStateCookie({
    state,
    nonce,
    intent,
    link,
    authUserId,
  });

  const lineAuthorizeUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  lineAuthorizeUrl.searchParams.set('response_type', 'code');
  lineAuthorizeUrl.searchParams.set('client_id', config.channelId);
  lineAuthorizeUrl.searchParams.set('redirect_uri', config.callbackUrl);
  lineAuthorizeUrl.searchParams.set('state', state);
  lineAuthorizeUrl.searchParams.set('scope', 'profile openid');
  lineAuthorizeUrl.searchParams.set('nonce', nonce);
  lineAuthorizeUrl.searchParams.set('bot_prompt', 'normal');

  return new Response(null, {
    status: 302,
    headers: {
      Location: lineAuthorizeUrl.toString(),
      'Set-Cookie': `line_auth_state=${stateCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
});

/**
 * GET /line/callback
 * Handles LINE Login callback. Validates state, exchanges code, verifies ID token.
 */
lineAuth.get('/callback', async (c) => {
  const config = getLineConfig();
  if (!config.featureEnabled) {
    return error(c, 404, 'NOT_FOUND', 'LINE Login is not enabled');
  }

  const code = c.req.query('code');
  const stateParam = c.req.query('state');
  const errorParam = c.req.query('error');

  if (errorParam) {
    const desc = c.req.query('error_description') ?? 'Login cancelled';
    return redirectWithError(config.appBaseUrl, desc);
  }

  if (!code || !stateParam) {
    return error(c, 400, 'BAD_REQUEST', 'Missing code or state');
  }

  // Validate state from cookie
  const cookieHeader = c.req.header('Cookie') ?? '';
  const stateMatch = cookieHeader.match(/line_auth_state=([^;]+)/);
  if (!stateMatch) {
    return error(c, 400, 'BAD_REQUEST', 'Missing state cookie');
  }

  const storedState = await decodeStateCookie(stateMatch[1]);
  if (!storedState || storedState.state !== stateParam) {
    return error(c, 400, 'BAD_REQUEST', 'Invalid state parameter');
  }

  const storedNonce = storedState.nonce as string;
  const intent = storedState.intent as string | undefined;
  const isLink = storedState.link as boolean;
  const linkAuthUserId = storedState.authUserId as string | undefined;

  // Exchange code for tokens
  const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.callbackUrl,
      client_id: config.channelId,
      client_secret: config.channelSecret,
    }),
  });

  if (!tokenRes.ok) {
    let body: unknown;
    try { body = await tokenRes.json(); } catch { body = await tokenRes.text().catch(() => '<unreadable>'); }
    console.error('[LINE callback] Token exchange failed:', JSON.stringify({
      status: tokenRes.status,
      body,
      clientIdUsed: config.channelId,
      redirectUriUsed: config.callbackUrl,
    }));
    return redirectWithError(config.appBaseUrl, 'Failed to exchange authorization code');
  }

  const tokenData = await tokenRes.json() as {
    access_token: string;
    id_token: string;
    token_type: string;
  };

  // Verify the ID token using HS256 + channel secret (LINE web login standard)
  // LINE web login signs id_tokens with HS256 using the channel secret as key.
  // Native/LIFF uses ES256 + JWKS, but web OAuth uses symmetric HS256.
  // See: https://developers.line.biz/en/docs/line-login/verify-id-token/
  let lineUserId: string;
  let displayName: string;
  let pictureUrl: string | undefined;

  try {
    const secret = new TextEncoder().encode(config.channelSecret);
    const { payload } = await jose.jwtVerify(tokenData.id_token, secret, {
      issuer: 'https://access.line.me',
      audience: config.channelId,
      algorithms: ['HS256'],
    });

    // Verify nonce
    if (payload.nonce !== storedNonce) {
      return error(c, 400, 'BAD_REQUEST', 'Nonce mismatch');
    }

    lineUserId = payload.sub as string;
    displayName = (payload.name as string) ?? 'LINE User';
    pictureUrl = payload.picture as string | undefined;
  } catch (err) {
    // Structured logging — surface jose verification failure details
    const joseErr = err instanceof Error ? err : new Error(String(err));
    const details: Record<string, unknown> = {
      errorName: joseErr.name,
      errorMessage: joseErr.message,
      errorCode: (err as { code?: string }).code,
      claim: (err as { claim?: string }).claim,
      reason: (err as { reason?: string }).reason,
      expectedAudience: config.channelId,
      expectedIssuer: 'https://access.line.me',
    };

    // Decode token claims without verification for diagnosis
    try {
      const claims = jose.decodeJwt(tokenData.id_token);
      details.actualAudience = claims.aud;
      details.actualIssuer = claims.iss;
      details.actualExpiry = claims.exp;
      details.actualIssuedAt = claims.iat;
      details.serverTime = Math.floor(Date.now() / 1000);
    } catch {
      details.decodeError = 'Could not decode JWT claims';
    }

    console.error('[LINE callback] ID token verification failed:', JSON.stringify(details));
    return error(c, 400, 'BAD_REQUEST', 'Invalid ID token');
  }

  const db = getDb();

  // Link mode: attach LINE identity to existing email customer
  if (isLink && linkAuthUserId) {
    try {
      // Find the email customer
      const emailCustomer = await db.customer.findUnique({
        where: { id: linkAuthUserId },
      });
      if (!emailCustomer) {
        return redirectWithError(config.appBaseUrl, 'Customer not found');
      }

      // Check if LINE identity already belongs to another customer
      const existingLineIdentity = await db.customerIdentity.findUnique({
        where: { provider_providerSubject: { provider: 'line', providerSubject: lineUserId } },
      });

      if (existingLineIdentity && existingLineIdentity.customerId !== emailCustomer.id) {
        // 409 — LINE account already linked to a different customer
        return redirectWithResult(config.appBaseUrl, intent, {
          error: 'line_already_linked',
          message: 'This LINE account is already linked to another account',
        });
      }

      if (!existingLineIdentity) {
        // Create LINE identity for this customer
        await db.customerIdentity.create({
          data: {
            customerId: emailCustomer.id,
            provider: 'line',
            providerSubject: lineUserId,
            verificationMethod: 'line_login',
            verifiedAt: new Date(),
            lastUsedAt: new Date(),
          },
        });
      }

      // Update LINE cache on customer
      await db.customer.update({
        where: { id: emailCustomer.id },
        data: {
          lineUserId,
          lineDisplayName: displayName,
          linePictureUrl: pictureUrl,
        },
      });

      return redirectWithResult(config.appBaseUrl, intent, { linked: true });
    } catch (err) {
      console.error('LINE link error:', err);
      return redirectWithError(config.appBaseUrl, 'Failed to link LINE account');
    }
  }

  // Normal sign-in / sign-up: resolve customer via LINE identity
  try {
    const result = await syncLineIdentity(db, {
      lineUserId,
      displayName,
      pictureUrl,
    });

    const customer = await db.customer.findUnique({
      where: { id: result.customerId },
      select: { id: true, email: true },
    });

    const token = await createCustomerToken(
      result.customerId,
      customer?.email ?? `line_${lineUserId}@placeholder.local`,
    );

    // Redirect back to the app with the token
    return redirectWithToken(config.appBaseUrl, intent, token);
  } catch (err) {
    console.error('LINE sign-in error:', err);
    return redirectWithError(config.appBaseUrl, 'Failed to sign in with LINE');
  }
});

function redirectWithToken(appBaseUrl: string, intent: string | undefined, token: string): Response {
  let returnPath = '/th/profile';
  if (intent) {
    try {
      const decoded = JSON.parse(atob(intent));
      if (decoded.returnPath) returnPath = decoded.returnPath;
    } catch { /* use default */ }
  }

  const url = new URL(returnPath, appBaseUrl);
  url.searchParams.set('line_token', token);

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': 'line_auth_state=; Path=/; HttpOnly; Max-Age=0',
    },
  });
}

function redirectWithResult(appBaseUrl: string, intent: string | undefined, result: Record<string, unknown>): Response {
  let returnPath = '/th/profile';
  if (intent) {
    try {
      const decoded = JSON.parse(atob(intent));
      if (decoded.returnPath) returnPath = decoded.returnPath;
    } catch { /* use default */ }
  }

  const url = new URL(returnPath, appBaseUrl);
  for (const [key, val] of Object.entries(result)) {
    url.searchParams.set(`line_${key}`, String(val));
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': 'line_auth_state=; Path=/; HttpOnly; Max-Age=0',
    },
  });
}

function redirectWithError(appBaseUrl: string, message: string): Response {
  const url = new URL('/th/profile', appBaseUrl);
  url.searchParams.set('line_error', message);

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': 'line_auth_state=; Path=/; HttpOnly; Max-Age=0',
    },
  });
}

export default lineAuth;
