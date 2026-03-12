/**
 * Three-step mutual authentication handshake protocol.
 *
 * 1. Challenger sends AuthChallenge (nonce + HMAC)
 * 2. Responder verifies challenge, sends AuthResponse (new nonce + HMAC)
 * 3. Challenger verifies response, sends AuthVerification (HMAC of response nonce)
 *
 * Both sides prove knowledge of the shared secret without transmitting it.
 */

import { computeHmac, generateNonce, verifyHmac } from './hmac.js';
import type { AuthChallenge, AuthResponse, AuthResult, AuthVerification } from './types.js';

/**
 * Step 1: Create an authentication challenge.
 * The challenger generates a nonce and HMACs it with the shared secret.
 */
export function createChallenge(challengerId: string, sharedSecret: string): AuthChallenge {
  const nonce = generateNonce();
  const timestamp = new Date().toISOString();
  const data = `${nonce}|${challengerId}|${timestamp}`;
  const hmac = computeHmac(data, sharedSecret);

  return { nonce, challengerId, timestamp, hmac };
}

/**
 * Step 2: Verify a challenge and create a response.
 * The responder verifies the challenger's HMAC, then sends back a response
 * with a new nonce and its own HMAC.
 */
export function respondToChallenge(
  challenge: AuthChallenge,
  responderId: string,
  sharedSecret: string,
  challengeWindowMs = 30_000,
): { response: AuthResponse; result: AuthResult } {
  // Verify challenge timestamp is within window
  const challengeTime = new Date(challenge.timestamp).getTime();
  const now = Date.now();
  if (Math.abs(now - challengeTime) > challengeWindowMs) {
    return {
      response: null as unknown as AuthResponse,
      result: {
        authenticated: false,
        peerId: null,
        error: 'Challenge expired or clock skew too large',
      },
    };
  }

  // Verify challenge HMAC
  const challengeData = `${challenge.nonce}|${challenge.challengerId}|${challenge.timestamp}`;
  if (!verifyHmac(challengeData, challenge.hmac, sharedSecret)) {
    return {
      response: null as unknown as AuthResponse,
      result: {
        authenticated: false,
        peerId: null,
        error: 'Invalid challenge HMAC — shared secret mismatch',
      },
    };
  }

  // Create response
  const responseNonce = generateNonce();
  const timestamp = new Date().toISOString();
  const responseData = `${challenge.nonce}|${responseNonce}|${responderId}|${timestamp}`;
  const hmac = computeHmac(responseData, sharedSecret);

  const response: AuthResponse = {
    originalNonce: challenge.nonce,
    responseNonce,
    responderId,
    timestamp,
    hmac,
  };

  return {
    response,
    result: { authenticated: true, peerId: challenge.challengerId, error: null },
  };
}

/**
 * Step 3: Verify the response and complete mutual authentication.
 * The challenger verifies the responder's HMAC and sends a final verification.
 */
export function verifyResponse(
  challenge: AuthChallenge,
  response: AuthResponse,
  verifierId: string,
  sharedSecret: string,
): { verification: AuthVerification | null; result: AuthResult } {
  // Verify the original nonce matches
  if (response.originalNonce !== challenge.nonce) {
    return {
      verification: null,
      result: {
        authenticated: false,
        peerId: null,
        error: 'Response nonce does not match challenge',
      },
    };
  }

  // Verify response HMAC
  const responseData = `${response.originalNonce}|${response.responseNonce}|${response.responderId}|${response.timestamp}`;
  if (!verifyHmac(responseData, response.hmac, sharedSecret)) {
    return {
      verification: null,
      result: {
        authenticated: false,
        peerId: null,
        error: 'Invalid response HMAC — shared secret mismatch',
      },
    };
  }

  // Create final verification
  const verificationData = `${response.responseNonce}|${verifierId}`;
  const hmac = computeHmac(verificationData, sharedSecret);

  const verification: AuthVerification = {
    responseNonce: response.responseNonce,
    verifierId,
    hmac,
  };

  return {
    verification,
    result: { authenticated: true, peerId: response.responderId, error: null },
  };
}

/**
 * Final step: Responder verifies the verification message.
 * Confirms the challenger also knows the shared secret.
 */
export function verifyVerification(
  verification: AuthVerification,
  responseNonce: string,
  sharedSecret: string,
): AuthResult {
  if (verification.responseNonce !== responseNonce) {
    return {
      authenticated: false,
      peerId: null,
      error: 'Verification nonce mismatch',
    };
  }

  const data = `${verification.responseNonce}|${verification.verifierId}`;
  if (!verifyHmac(data, verification.hmac, sharedSecret)) {
    return {
      authenticated: false,
      peerId: null,
      error: 'Invalid verification HMAC',
    };
  }

  return {
    authenticated: true,
    peerId: verification.verifierId,
    error: null,
  };
}
