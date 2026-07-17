'use strict';

const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// ADJUST THIS to however the rest of your app gets its Prisma client.
// If your other routes use `fastify.prisma`, delete this line and use that
// inside the handlers instead. If you export a singleton, point this at it
// (e.g. require('../db') or require('../db')).
const prisma = require('../db');
// ─────────────────────────────────────────────────────────────────────────────

const VERIFF_BASE_URL = process.env.VERIFF_API_URL || 'https://stationapi.veriff.com/v1';
const VERIFF_API_KEY = process.env.VERIFF_API_KEY;
const VERIFF_SHARED_SECRET = process.env.VERIFF_SHARED_SECRET;

// Twilio Verify (handles code generation + checking server-side, so no DB table
// is needed). Swap this block out if you use a different SMS provider.
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

// HMAC-SHA256 hex of `payload` (string or Buffer) using the Veriff shared secret.
function veriffSignature(payload) {
  return crypto.createHmac('sha256', VERIFF_SHARED_SECRET).update(payload).digest('hex');
}

// Constant-time string compare to avoid timing attacks on the webhook signature.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = async function (fastify, opts) {
  // Veriff signs webhooks over the RAW request bytes, so we capture them before
  // JSON.parse. This content-type parser is encapsulated to THIS plugin only —
  // your /api/subscriptions and other JSON routes are not affected.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      req.rawBody = body; // Buffer
      if (!body || body.length === 0) return done(null, {});
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (err) {
        err.statusCode = 400;
        done(err, undefined);
      }
    }
  );

  // Reads the authenticated user id. Assumes your existing auth hook populates
  // request.user — the same mechanism your /api/subscriptions routes rely on.
  // (The /webhook route below intentionally does NOT use this — it's called by
  // Veriff, not a logged-in user, and is secured by the HMAC signature instead.)
  function requireUserId(request, reply) {
    const userId = request.user && request.user.id;
    if (!userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return null;
    }
    return userId;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1) CREATE VERIFF SESSION
  // ── Status endpoint ──
  fastify.get("/status", async (request, reply) => {
    var userId = requireUserId(request, reply); if (!userId) return;
    var user = await prisma.user.findUnique({ where: { id: userId }, select: { selfieVerified: true, idVerified: true, phoneVerified: true, trustScore: true } });
    if (!user) return reply.code(404).send({ error: "User not found" });
    return { selfie: user.selfieVerified || false, id: user.idVerified || false, phone: user.phoneVerified || false, trustScore: user.trustScore || "unverified" };
  });

  //    Mobile calls this, then opens the returned `url` with Linking.openURL().
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post('/create-session', async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    try {
      const res = await fetch(`${VERIFF_BASE_URL}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AUTH-CLIENT': VERIFF_API_KEY,
        },
        body: JSON.stringify({
          verification: {
            // vendorData lets the decision webhook map results back to this user.
            vendorData: String(userId),
            // Where Veriff redirects the end-user once they finish in the browser.
            // For Expo Go set VERIFF_CALLBACK_URL to a deep link or a simple
            // "you can return to the app now" web page. Optional.
            callback: process.env.VERIFF_CALLBACK_URL || undefined,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.verification) {
        request.log.error({ status: res.status, data }, 'Veriff session creation failed');
        return reply.code(502).send({ error: 'Could not create verification session' });
      }

      return reply.send({
        url: data.verification.url, // open this on the device
        sessionId: data.verification.id, // keep this; send it to /complete-id-check
        status: data.verification.status, // "created"
      });
    } catch (err) {
      request.log.error(err, 'Veriff create-session error');
      return reply.code(500).send({ error: 'Verification service unavailable' });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2) WEBHOOK HANDLER
  //    Set this as your *Decision* webhook in the Veriff Customer Portal:
  //      https://<your-app>.up.railway.app/api/verification/webhook
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post('/webhook', async (request, reply) => {
    const signature = request.headers['x-hmac-signature'];
    const raw = request.rawBody || Buffer.from(JSON.stringify(request.body || {}));

    if (!signature || !safeEqual(signature, veriffSignature(raw))) {
      request.log.warn('Veriff webhook: invalid or missing signature');
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const body = request.body || {};
    // Handle both the classic decision webhook and the full-auto webhook shapes.
    const verification = body.verification || (body.data && body.data.verification) || {};
    const decision = verification.status || verification.decision; // approved | declined | ...
    const vendorData = verification.vendorData || body.vendorData; // = the user id we set

    if (!vendorData) {
      request.log.warn({ body }, 'Veriff webhook: no vendorData, cannot map to a user');
      return reply.code(200).send({ ok: true }); // ack so Veriff stops retrying
    }

    try {
      const approved = decision === 'approved';
      // Veriff handles the ID DOCUMENT only here. The selfie/liveness is your
      // separate in-app step 2 (POST /selfie-result), so we set idVerified only
      // and never touch selfieVerified from the Veriff decision.
      await prisma.user.update({
        where: { id: vendorData }, // NOTE: if User.id is an Int, use Number(vendorData)
        data: {
          idVerified: approved,
        },
      });
    } catch (err) {
      // Never 500 here — Veriff would just retry. Log and acknowledge.
      request.log.error(err, 'Veriff webhook: failed to update user');
    }

    return reply.code(200).send({ ok: true });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3) SELFIE RESULT
  //    Your app's in-app liveness step (step 2) posts its result here. It sends
  //    { passed, faceDetected, livenessConfirmed } and fires-and-forgets, so we
  //    just record selfieVerified and ack. THIS is what sets selfieVerified —
  //    not Veriff.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post('/selfie-result', async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const { passed } = request.body || {};
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { selfieVerified: !!passed },
      });
    } catch (err) {
      request.log.error(err, 'selfie-result: failed to update user');
      return reply.code(500).send({ error: 'Could not save selfie result' });
    }
    return reply.send({ ok: true, selfieVerified: !!passed });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4) COMPLETE ID CHECK
  //    Called by the app after the user returns from the Veriff URL. Actively
  //    pulls the decision from Veriff (so it works even if the webhook is slow
  //    or not yet configured) and updates the flags.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post('/complete-id-check', async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const { sessionId } = request.body || {};
    if (!sessionId) return reply.code(400).send({ error: 'sessionId is required' });

    try {
      const res = await fetch(`${VERIFF_BASE_URL}/sessions/${sessionId}/decision`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-AUTH-CLIENT': VERIFF_API_KEY,
          // GET /decision is signed over the sessionId. If you ever get 401s
          // here, try signing the full request path instead:
          //   veriffSignature(`/v1/sessions/${sessionId}/decision`)
          'X-HMAC-SIGNATURE': veriffSignature(sessionId),
        },
      });

      // While there is no conclusive decision yet, Veriff returns 404 (or a body
      // with a null verification). Treat both as "pending".
      if (res.status === 404) return reply.send({ status: 'pending' });

      const data = await res.json();
      const verification = data && data.verification;
      if (!verification || !verification.status) {
        return reply.send({ status: 'pending' });
      }

      const decision = verification.status; // approved | declined | resubmission_requested | ...
      const approved = decision === 'approved';

      await prisma.user.update({
        where: { id: userId },
        data: { idVerified: approved },
      });

      return reply.send({ status: decision, idVerified: approved });
    } catch (err) {
      request.log.error(err, 'Veriff complete-id-check error');
      return reply.code(500).send({ error: 'Could not fetch verification decision' });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5) SEND SMS CODE  (Twilio Verify)
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post('/send-sms-code', async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const { phoneNumber } = request.body || {};
    if (!phoneNumber) {
      return reply.code(400).send({ error: 'phoneNumber is required (E.164, e.g. +447700900000)' });
    }

    try {
      const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
      const res = await fetch(
        `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/Verifications`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: phoneNumber, Channel: 'sms' }).toString(),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        request.log.error({ status: res.status, data }, 'Twilio send-code failed');
        return reply.code(502).send({ error: 'Could not send SMS code' });
      }

      return reply.send({ status: data.status }); // "pending"
    } catch (err) {
      request.log.error(err, 'send-sms-code error');
      return reply.code(500).send({ error: 'SMS service unavailable' });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6) VERIFY SMS CODE  (Twilio Verify)
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post('/verify-sms-code', async (request, reply) => {
    const userId = requireUserId(request, reply);
    if (!userId) return;

    const { phoneNumber, code } = request.body || {};
    if (!phoneNumber || !code) {
      return reply.code(400).send({ error: 'phoneNumber and code are required' });
    }

    try {
      const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
      const res = await fetch(
        `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: phoneNumber, Code: String(code) }).toString(),
        }
      );

      const data = await res.json();
      const approved = res.ok && data.status === 'approved';
      if (!approved) {
        // 200 with a status the client can read (it checks result.status === 'verified'
        // and otherwise shows result.error), rather than throwing on a wrong code.
        return reply.send({ status: 'failed', error: 'Invalid or expired code' });
      }

      await prisma.user.update({
        where: { id: userId },
        data: { phoneVerified: true },
      });

      return reply.send({ status: 'verified' });
    } catch (err) {
      request.log.error(err, 'verify-sms-code error');
      return reply.code(500).send({ error: 'SMS service unavailable' });
    }
  });
};
