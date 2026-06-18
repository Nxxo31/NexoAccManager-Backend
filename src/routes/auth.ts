import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../prisma/client';
import { 
  hashPassword, 
  comparePassword, 
  generateAccessToken, 
  generateRefreshToken, 
  verifyAccessToken, 
  verifyRefreshToken,
  storeRefreshToken,
  useRefreshToken,
  findRefreshToken,
} from '../lib/jwt';

export { verifyAccessToken, verifyRefreshToken };

export async function register(request: FastifyRequest, reply: FastifyReply) {
  const { email, password, name } = request.body as { email: string; password: string; name?: string };

  if (!email || !password) {
    return reply.status(400).send({ error: 'Email and password are required' });
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return reply.status(409).send({ error: 'User already exists' });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
    },
  });

  // Create a free license for the user
  await prisma.license.create({
    data: {
      userId: user.id,
      plan: 'FREE',
      accountLimit: 5,
    },
  });

  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await storeRefreshToken(user.id, refreshToken);

  reply.send({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  });
}

export async function login(request: FastifyRequest, reply: FastifyReply) {
  const { email, password } = request.body as { email: string; password: string };

  if (!email || !password) {
    return reply.status(400).send({ error: 'Email and password are required' });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return reply.status(401).send({ error: 'Invalid credentials' });
  }

  const passwordValid = await comparePassword(password, user.passwordHash);
  if (!passwordValid) {
    return reply.status(401).send({ error: 'Invalid credentials' });
  }

  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await storeRefreshToken(user.id, refreshToken);

  reply.send({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  });
}

export async function refresh(request: FastifyRequest, reply: FastifyReply) {
  const { refreshToken } = request.body as { refreshToken: string };

  if (!refreshToken) {
    return reply.status(400).send({ error: 'Refresh token required' });
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    return reply.status(401).send({ error: 'Invalid refresh token' });
  }

  const tokenRecord = await findRefreshToken(refreshToken);
  if (!tokenRecord || tokenRecord.used) {
    return reply.status(401).send({ error: 'Refresh token already used' });
  }

  // Mark old refresh token as used
  await useRefreshToken(tokenRecord.id);

  const newAccessToken = generateAccessToken(payload.userId);
  const newRefreshToken = generateRefreshToken(payload.userId);
  await storeRefreshToken(payload.userId, newRefreshToken);

  reply.send({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  });
}

export async function logout(request: FastifyRequest, reply: FastifyReply) {
  const { refreshToken } = request.body as { refreshToken: string };

  if (!refreshToken) {
    return reply.status(400).send({ error: 'Refresh token required' });
  }

  try {
    verifyRefreshToken(refreshToken);
  } catch (err) {
    return reply.status(401).send({ error: 'Invalid refresh token' });
  }

  const tokenRecord = await findRefreshToken(refreshToken);
  if (tokenRecord) {
    await useRefreshToken(tokenRecord.id);
  }

  reply.send({ success: true });
}

// Stub endpoints for email verification and password reset
export async function verifyEmail(request: FastifyRequest, reply: FastifyReply) {
  // TODO: implement email verification token verification
  reply.send({ success: true, message: 'Email verified (stub)' });
}

export async function forgotPassword(request: FastifyRequest, reply: FastifyReply) {
  // TODO: implement forgot password flow
  reply.send({ success: true, message: 'Password reset email sent (stub)' });
}

export async function resetPassword(request: FastifyRequest, reply: FastifyReply) {
  // TODO: implement reset password with token
  reply.send({ success: true, message: 'Password reset (stub)' });
}