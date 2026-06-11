const prisma = require('../db');

async function verificationRoutes(app) {
  // Get verification status
  app.get('/status', { preHandler: [app.authenticate] }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: { phoneVerified: true, selfieVerified: true, idVerified: true, trustScore: true, plan: true },
    });
    return { verification: user, tier: user.idVerified ? 'full' : user.selfieVerified ? 'basic' : 'none', badgeColor: user.trustScore };
  });

  // ═══ FREE TIER: Selfie liveness result ═══
  app.post('/selfie-result', { preHandler: [app.authenticate] }, async (request) => {
    const { passed, faceDetected, livenessConfirmed } = request.body;
    if (passed && faceDetected && livenessConfirmed) {
      await prisma.user.update({ where: { id: request.user.id }, data: { selfieVerified: true, trustScore: 'yellow' } });
      return { status: 'verified', badge: 'yellow' };
    } else {
      await prisma.user.update({ where: { id: request.user.id }, data: { selfieVerified: false, trustScore: 'red' } });
      return { status: 'failed', badge: 'red', reason: !faceDetected ? 'No human face detected' : 'Liveness check failed - use a live camera, not a photo of a photo' };
    }
  });

  // ═══ PAID TIER STEP 1: Create Stripe payment intent for verification (GBP 2.99) ═══
  app.post('/create-payment', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.id } });
    if (user.idVerified) return { status: 'already_verified' };

    // Free for paid subscribers
    if (user.plan === 'explorer' || user.plan === 'inner_circle') {
      return { status: 'included_in_plan', skipPayment: true };
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      // Demo mode
      return { status: 'demo_mode', skipPayment: true, message: 'Stripe not configured - proceeding in demo mode' };
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // Create or retrieve Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id, alias: user.alias } });
      customerId = customer.id;
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    }

    // Create payment intent for GBP 2.99
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 299, // GBP 2.99 in pence
      currency: 'gbp',
      customer: customerId,
      metadata: { userId: user.id, type: 'id_verification' },
    });

    return { clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id };
  });

  // ═══ PAID TIER STEP 1b: Confirm payment received ═══
  app.post('/confirm-payment', { preHandler: [app.authenticate] }, async (request) => {
    const { paymentIntentId } = request.body;

    if (process.env.STRIPE_SECRET_KEY && paymentIntentId) {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.status !== 'succeeded') return { error: 'Payment not completed' };
    }

    return { status: 'payment_confirmed', nextStep: 'id_verification' };
  });

  // ═══ PAID TIER STEP 2: Create Onfido SDK token for ID verification ═══
  app.post('/create-id-check', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.id } });

    if (!process.env.ONFIDO_API_TOKEN) {
      // Demo mode - simulate verification
      return { status: 'demo_mode', message: 'Onfido not configured - simulating ID check' };
    }

    // Create Onfido applicant
    const onfidoRes = await fetch('https://api.eu.onfido.com/v3.6/applicants', {
      method: 'POST',
      headers: { 'Authorization': 'Token token=' + process.env.ONFIDO_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: user.alias, last_name: 'User', email: user.email }),
    });
    const applicant = await onfidoRes.json();

    // Create SDK token
    const tokenRes = await fetch('https://api.eu.onfido.com/v3.6/sdk_token', {
      method: 'POST',
      headers: { 'Authorization': 'Token token=' + process.env.ONFIDO_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicant_id: applicant.id, referrer: '*://*/*' }),
    });
    const sdkToken = await tokenRes.json();

    return { sdkToken: sdkToken.token, applicantId: applicant.id };
  });

  // ═══ PAID TIER STEP 2b: Complete ID check (webhook or poll) ═══
  app.post('/complete-id-check', { preHandler: [app.authenticate] }, async (request) => {
    const { applicantId, passed } = request.body;

    if (passed || !process.env.ONFIDO_API_TOKEN) {
      await prisma.user.update({ where: { id: request.user.id }, data: { idVerified: true, selfieVerified: true } });
      return { status: 'id_verified', nextStep: 'phone_verification' };
    }

    return { status: 'id_failed', reason: 'ID verification did not pass. Please try again with a valid government ID.' };
  });

  // ═══ PAID TIER STEP 3: Send SMS verification code via Twilio ═══
  app.post('/send-sms-code', { preHandler: [app.authenticate] }, async (request) => {
    const { phoneNumber } = request.body;
    if (!phoneNumber) return { error: 'Phone number required' };

    // Validate phone format (basic UK check)
    const cleaned = phoneNumber.replace(/\s/g, '');
    if (!/^\+?[\d]{10,15}$/.test(cleaned)) return { error: 'Invalid phone number format. Include country code, e.g. +447...' };

    if (!process.env.TWILIO_ACCOUNT_SID) {
      // Demo mode
      return { status: 'demo_mode', message: 'Code sent (demo mode - any 6 digits will work)' };
    }

    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilio.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID).verifications.create({ to: cleaned, channel: 'sms' });

    return { status: 'code_sent', phone: cleaned.slice(0, 4) + '****' + cleaned.slice(-3) };
  });

  // ═══ PAID TIER STEP 3b: Verify SMS code ═══
  app.post('/verify-sms-code', { preHandler: [app.authenticate] }, async (request) => {
    const { phoneNumber, code } = request.body;
    if (!phoneNumber || !code) return { error: 'Phone number and code required' };

    const cleaned = phoneNumber.replace(/\s/g, '');

    if (!process.env.TWILIO_ACCOUNT_SID) {
      // Demo mode - accept any 6-digit code
      if (code.length === 6 && /^\d{6}$/.test(code)) {
        await prisma.user.update({ where: { id: request.user.id }, data: { phoneVerified: true, phone: cleaned, trustScore: 'green' } });
        return { status: 'verified', badge: 'green' };
      }
      return { error: 'Invalid code. Enter 6 digits.' };
    }

    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const verification = await twilio.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID).verificationChecks.create({ to: cleaned, code });

    if (verification.status === 'approved') {
      await prisma.user.update({ where: { id: request.user.id }, data: { phoneVerified: true, phone: cleaned, trustScore: 'green' } });
      return { status: 'verified', badge: 'green' };
    }

    return { error: 'Invalid code. Please check and try again.' };
  });

  // ═══ SUBSCRIPTION CHECKOUT (Stripe) ═══
  app.post('/subscribe', { preHandler: [app.authenticate] }, async (request) => {
    const { plan, billing } = request.body;
    const user = await prisma.user.findUnique({ where: { id: request.user.id } });

    if (!process.env.STRIPE_SECRET_KEY) {
      // Demo mode - upgrade directly
      await prisma.user.update({
        where: { id: request.user.id },
        data: { plan, planExpiresAt: new Date(Date.now() + (billing === 'yearly' ? 365 : 30) * 86400000), idVerified: true, selfieVerified: true, phoneVerified: true, trustScore: 'green' },
      });
      return { status: 'upgraded', plan, demo: true };
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } });
      customerId = customer.id;
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    }

    const priceMap = {
      explorer_monthly: process.env.STRIPE_EXPLORER_MONTHLY_PRICE_ID,
      explorer_yearly: process.env.STRIPE_EXPLORER_YEARLY_PRICE_ID,
      inner_circle_monthly: process.env.STRIPE_INNER_MONTHLY_PRICE_ID,
      inner_circle_yearly: process.env.STRIPE_INNER_YEARLY_PRICE_ID,
    };
    const priceId = priceMap[plan + '_' + billing];
    if (!priceId) return { error: 'Invalid plan or billing period' };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://riff-app.co.uk/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://riff-app.co.uk/cancel',
      metadata: { userId: user.id, plan, billing },
    });

    return { checkoutUrl: session.url, sessionId: session.id };
  });
}

module.exports = verificationRoutes;
