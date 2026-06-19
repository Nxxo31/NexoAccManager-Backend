import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../prisma/client';
import { verifyAccessToken } from '../lib/jwt';

// Plan definitions with pricing and features
export const PLANS = [
  {
    id: 'FREE',
    name: 'Free',
    price: 0,
    accountLimit: 5,
    features: ['Core features', 'Server Browser', 'Basic support'],
  },
  {
    id: 'STARTER',
    name: 'Starter',
    price: 5,
    accountLimit: 10,
    features: ['Auto Cookie Refresh', 'Presence Dashboard', 'Priority support'],
  },
  {
    id: 'PRO',
    name: 'Pro',
    price: 10,
    accountLimit: 20,
    features: ['Smart Server Selection', 'Player Finder', 'Advanced analytics'],
  },
  {
    id: 'BUSINESS',
    name: 'Business',
    price: 20,
    accountLimit: 30,
    features: ['Account Control Panel', 'Dashboard Web', 'Team management'],
  },
  {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    price: 50,
    accountLimit: 999999,
    features: ['Everything', 'Priority support', 'Custom themes', 'Dedicated account manager'],
  },
];

// GET /license/verify — returns current user's license
export async function getLicenseVerify(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Extract token from Authorization header
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.slice(7);
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }

    const license = await prisma.license.findUnique({
      where: { userId: payload.userId },
      include: { user: { select: { email: true, name: true } } },
    });

    if (!license) {
      return reply.status(404).send({ error: 'License not found' });
    }

    const plan = PLANS.find((p) => p.id === license.plan);

    return reply.send({
      plan: license.plan,
      accountLimit: license.accountLimit,
      status: license.status,
      currentPeriodEnd: license.currentPeriodEnd,
      stripeCustomerId: license.stripeCustomerId,
      stripeSubscriptionId: license.stripeSubscriptionId,
      planDetails: plan || null,
    });
  } catch (error) {
    console.error('Error in getLicenseVerify:', error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
}

// GET /license/plans — public endpoint, returns all available plans
export async function getLicensePlans(request: FastifyRequest, reply: FastifyReply) {
  try {
    return reply.send({ plans: PLANS });
  } catch (error) {
    console.error('Error in getLicensePlans:', error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
}
