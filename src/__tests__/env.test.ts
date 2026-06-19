import { describe, it, expect } from 'vitest';

describe('Environment Setup', () => {
  it('should have JWT_PRIVATE_KEY defined', () => {
    expect(process.env.JWT_PRIVATE_KEY).toBeDefined();
    expect(process.env.JWT_PRIVATE_KEY.length).toBeGreaterThan(0);
  });

  it('should have JWT_PUBLIC_KEY defined', () => {
    expect(process.env.JWT_PUBLIC_KEY).toBeDefined();
    expect(process.env.JWT_PUBLIC_KEY.length).toBeGreaterThan(0);
  });

  it('should have JWT_SECRET defined', () => {
    expect(process.env.JWT_SECRET).toBeDefined();
    expect(process.env.JWT_SECRET.length).toBeGreaterThan(0);
  });

  it('should have DATABASE_URL defined', () => {
    expect(process.env.DATABASE_URL).toBeDefined();
    expect(process.env.DATABASE_URL).toContain('test.db');
  });
});