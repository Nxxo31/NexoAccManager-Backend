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
import { sendVerificationEmail, sendPasswordResetEmail, verifyEmailToken } from '../lib/email';
import { PLANS } from './license';

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

  // Send email verification (non-blocking — don't fail registration if email fails)
  sendVerificationEmail(user.id, email).catch((err) => {
    console.error('[Auth] Failed to send verification email:', err);
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

// GET /auth/me — returns current user profile with license
export async function getMe(request: FastifyRequest, reply: FastifyReply) {
  const userId = (request as any).userId;
  if (!userId) {
    return reply.status(401).send({ error: 'Not authenticated' });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
      language: true,
      createdAt: true,
      license: {
        select: {
          plan: true,
          accountLimit: true,
          status: true,
          currentPeriodEnd: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
        },
      },
    },
  });

  if (!user) {
    return reply.status(404).send({ error: 'User not found' });
  }

  const plan = PLANS.find((p) => p.id === (user.license?.plan ?? 'FREE'));

  return reply.send({
    ...user,
    planDetails: plan || null,
  });
}

// PATCH /auth/me — update user preferences (language, name)
export async function updateMe(request: FastifyRequest, reply: FastifyReply) {
  const userId = (request as any).userId;
  if (!userId) {
    return reply.status(401).send({ error: 'Not authenticated' });
  }

  const { language, name } = request.body as { language?: string; name?: string };

  const updateData: { language?: string; name?: string } = {};
  if (language !== undefined) {
    const valid = ['es', 'en', 'pt'];
    if (!valid.includes(language)) {
      return reply.status(400).send({ error: 'Invalid language. Must be: es, en, or pt' });
    }
    updateData.language = language;
  }
  if (name !== undefined) {
    updateData.name = name;
  }

  if (Object.keys(updateData).length === 0) {
    return reply.status(400).send({ error: 'No fields to update' });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: { id: true, email: true, name: true, language: true },
  });

  return reply.send(updated);
}

// POST /auth/verify-email — verify email from token in URL
export async function verifyEmail(request: FastifyRequest, reply: FastifyReply) {
  const { token } = request.body as { token: string };

  if (!token) {
    return reply.status(400).send({ error: 'Token is required' });
  }

  let payload;
  try {
    payload = verifyEmailToken(token);
  } catch {
    return reply.status(400).send({ error: 'Invalid or expired token' });
  }

  if (payload.purpose !== 'verify') {
    return reply.status(400).send({ error: 'Token is not an email verification token' });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) {
    return reply.status(404).send({ error: 'User not found' });
  }

  if (user.emailVerified) {
    return reply.send({ success: true, message: 'Email already verified' });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, emailVerifyToken: null },
  });

  return reply.send({ success: true, message: 'Email verified successfully' });
}

// POST /auth/forgot-password — send password reset email
export async function forgotPassword(request: FastifyRequest, reply: FastifyReply) {
  const { email } = request.body as { email: string };

  if (!email) {
    return reply.status(400).send({ error: 'Email is required' });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  
  // Always return 200 to prevent email enumeration attacks
  if (!user) {
    console.log(`[Auth] Forgot password for non-existent email: ${email}`);
    return reply.send({ success: true, message: 'If the email exists, a reset link has been sent' });
  }

  // Send reset email (non-blocking)
  sendPasswordResetEmail(user.id, email).catch((err) => {
    console.error('[Auth] Failed to send password reset email:', err);
  });

  return reply.send({ success: true, message: 'If the email exists, a reset link has been sent' });
}

// POST /auth/reset-password — reset password using token from email
export async function resetPassword(request: FastifyRequest, reply: FastifyReply) {
  const { token, newPassword } = request.body as { token: string; newPassword: string };

  if (!token || !newPassword) {
    return reply.status(400).send({ error: 'Token and new password are required' });
  }

  if (newPassword.length < 8) {
    return reply.status(400).send({ error: 'Password must be at least 8 characters' });
  }

  let payload;
  try {
    payload = verifyEmailToken(token);
  } catch {
    return reply.status(400).send({ error: 'Invalid or expired token' });
  }

  if (payload.purpose !== 'reset') {
    return reply.status(400).send({ error: 'Token is not a password reset token' });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) {
    return reply.status(404).send({ error: 'User not found' });
  }

  // Check password is not the same
  const samePassword = await comparePassword(newPassword, user.passwordHash);
  if (samePassword) {
    return reply.status(400).send({ error: 'New password must be different from current password' });
  }

  const newHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash, emailVerifyToken: null },
  });

  // Invalidate all existing refresh tokens (security: user may have been compromised)
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

  return reply.send({ success: true, message: 'Password reset successfully. Please login again.' });
}