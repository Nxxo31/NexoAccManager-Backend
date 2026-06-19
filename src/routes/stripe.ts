import { FastifyRequest, FastifyReply } from 'fastify';
import Stripe from 'stripe';
import { prisma } from '../prisma/client';

// Initialize Stripe — throws early if key is missing (fail fast in production)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2026-05-27.dahlia',
});

// Map plan names to Stripe Price IDs (set via environment variables)
const PLAN_PRICES: Record<string, string> = {
  STARTER: process.env.STRIPE_PRICE_STARTER || '',
  PRO: process.env.STRIPE_PRICE_PRO || '',
  BUSINESS: process.env.STRIPE_PRICE_BUSINESS || '',
  ENTERPRISE: process.env.STRIPE_PRICE_ENTERPRISE || '',
};

const PLAN_LIMITS: Record<string, number> = {
  FREE: 5,
  STARTER: 10,
  PRO: 20,
  BUSINESS: 30,
  ENTERPRISE: 999999,
};

// ─── POST /stripe/checkout/create-session ──────────────────────────────────
// Creates a Stripe Checkout session for the given plan.
// Requires valid Bearer token (userId attached by preHandler middleware).
export async function createCheckoutSession(request: FastifyRequest, reply: FastifyReply) {
  const { plan } = request.body as { plan: string };

  if (!plan || !PLAN_PRICES[plan]) {
    return reply.status(400).send({ error: 'Invalid plan', validPlans: Object.keys(PLAN_PRICES) });
  }

  const userId = (request as any).userId;
  if (!userId) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  // Get or create Stripe customer
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { license: true },
  });
  if (!user) {
    return reply.status(404).send({ error: 'User not found' });
  }

  let customerId = user.license?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await prisma.license.upsert({
      where: { userId: user.id },
      create: { userId: user.id, plan: 'FREE', accountLimit: 5 },
      update: { stripeCustomerId: customerId },
    });
  }

  const priceId = PLAN_PRICES[plan];
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: `${frontendUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/cancel`,
    metadata: { userId, plan },
  });

  return reply.send({ sessionId: session.id, url: session.url });
}

// ─── POST /stripe/webhook ───────────────────────────────────────────────────
// Receives Stripe webhook events. Verifies signature before processing.
export async function stripeWebhook(request: FastifyRequest, reply: FastifyReply) {
  const sig = request.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Use cached raw body for signature verification
  const rawBody = (request as any).rawBody as Buffer | undefined;

  let event: Stripe.Event;
  try {
    if (webhookSecret && sig && rawBody) {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } else if (webhookSecret && sig && !rawBody) {
      // Fallback: try with string body if cache miss (dev mode)
      const bodyStr = JSON.stringify(request.body);
      event = stripe.webhooks.constructEvent(Buffer.from(bodyStr), sig, webhookSecret);
    } else {
      // Development fallback — parse body directly (skip signature verification)
      event = request.body as Stripe.Event;
    }
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err);
    return reply.status(400).send({ error: 'Webhook signature verification failed' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan as string;
        const subscriptionId = session.subscription as string;

        if (userId && plan && PLAN_LIMITS[plan]) {
          await prisma.license.upsert({
            where: { userId },
            create: {
              userId,
              plan: plan as any,
              accountLimit: PLAN_LIMITS[plan],
              stripeCustomerId: session.customer as string,
              stripeSubscriptionId: subscriptionId,
              status: 'ACTIVE',
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
            update: {
              plan: plan as any,
              accountLimit: PLAN_LIMITS[plan],
              stripeSubscriptionId: subscriptionId,
              status: 'ACTIVE',
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          });
          console.log(`[Stripe] Plan upgraded to ${plan} for user ${userId}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const status = subscription.items.data[0]?.price?.id;

        // Map price ID to plan (reverse lookup)
        const plan = Object.entries(PLAN_PRICES).find(([, priceId]) => priceId === status)?.[0];
        if (customerId && plan) {
          await prisma.license.updateMany({
            where: { stripeCustomerId: customerId },
            data: {
              plan: plan as any,
              accountLimit: PLAN_LIMITS[plan],
              status: subscription.status === 'active' ? 'ACTIVE' : 'PAST_DUE',
            },
          });
          console.log(`[Stripe] Subscription updated to ${plan} for customer ${customerId}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        await prisma.license.updateMany({
          where: { stripeCustomerId: customerId },
          data: {
            plan: 'FREE',
            accountLimit: 5,
            stripeSubscriptionId: null,
            status: 'CANCELLED',
          },
        });
        console.log(`[Stripe] Subscription cancelled for customer ${customerId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        await prisma.license.updateMany({
          where: { stripeCustomerId: customerId },
          data: { status: 'PAST_DUE' },
        });
        console.log(`[Stripe] Payment failed for customer ${customerId}`);
        break;
      }

      default:
        console.log(`[Stripe] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error('[Stripe Webhook] Error processing event:', err);
    return reply.status(500).send({ error: 'Webhook processing failed' });
  }

  return reply.send({ received: true });
}

// ─── GET /stripe/plans ─────────────────────────────────────────────────────
// Returns available plans with prices (public endpoint)
export async function getStripePlans(_request: FastifyRequest, reply: FastifyReply) {
  const plans = Object.entries(PLAN_PRICES).map(([name, priceId]) => ({
    name,
    priceId,
    price: getPriceFromPriceId(priceId),
  }));
  return reply.send({ plans });
}

// ─── POST /stripe/portal ────────────────────────────────────────────────────
// Creates a Stripe Customer Portal session for managing subscription
export async function createPortalSession(request: FastifyRequest, reply: FastifyReply) {
  const userId = (request as any).userId;
  if (!userId) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const license = await prisma.license.findUnique({ where: { userId } });
  if (!license?.stripeCustomerId) {
    return reply.status(400).send({ error: 'No subscription found' });
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const session = await stripe.billingPortal.sessions.create({
    customer: license.stripeCustomerId,
    return_url: `${frontendUrl}/es/dashboard/billing`,
  });

  return reply.send({ url: session.url });
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function getPriceFromPriceId(priceId: string): string {
  // For development without real Stripe prices, return mock prices
  const mockPrices: Record<string, string> = {
    STARTER: '$5.00/mes',
    PRO: '$10.00/mes',
    BUSINESS: '$20.00/mes',
    ENTERPRISE: '$50.00/mes',
  };
  return mockPrices[priceId] || 'Price TBD';
}