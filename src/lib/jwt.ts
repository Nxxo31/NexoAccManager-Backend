import { sign, verify, JwtPayload } from 'jsonwebtoken';
import { prisma } from '../prisma/client';

// In production, these should be stored in environment variables
// For development, we'll generate if not present
const getPrivateKey = () => {
  const privateKey = process.env.JWT_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('JWT_PRIVATE_KEY is not defined');
  }
  return privateKey;
};

const getPublicKey = () => {
  const publicKey = process.env.JWT_PUBLIC_KEY;
  if (!publicKey) {
    throw new Error('JWT_PUBLIC_KEY is not defined');
  }
  return publicKey;
};

export const generateAccessToken = (userId: string) => {
  return sign(
    { userId, type: 'access' },
    getPrivateKey(),
    {
      algorithm: 'RS256',
      expiresIn: '15m',
    }
  );
};

export const generateRefreshToken = (userId: string) => {
  return sign(
    { userId, type: 'refresh' },
    getPrivateKey(),
    {
      algorithm: 'RS256',
      expiresIn: '30d',
    }
  );
};

export const verifyAccessToken = (token: string) => {
  return verify(token, getPublicKey(), { algorithms: ['RS256'] }) as JwtPayload;
};

export const verifyRefreshToken = (token: string) => {
  return verify(token, getPublicKey(), { algorithms: ['RS256'] }) as JwtPayload;
};

// Helper to hash password
import bcrypt from 'bcrypt';

export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
};

export const comparePassword = async (password: string, hashed: string): Promise<boolean> => {
  return bcrypt.compare(password, hashed);
};

// Create a new refresh token record
export const storeRefreshToken = async (userId: string, token: string) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

  return prisma.refreshToken.create({
    data: {
      token,
      userId,
      expiresAt,
    },
  });
};

// Find refresh token by token string
export const findRefreshToken = async (token: string) => {
  return prisma.refreshToken.findUnique({
    where: { token },
  });
};

// Mark refresh token as used
export const useRefreshToken = async (id: string) => {
  return prisma.refreshToken.update({
    where: { id },
    data: { used: true },
  });
};

// Delete used refresh tokens (optional cleanup)
export const deleteUsedRefreshTokens = async (userId: string) => {
  return prisma.refreshToken.deleteMany({
    where: {
      userId,
      used: true,
    },
  });
};