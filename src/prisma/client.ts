import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { resolve } from 'path';

const sqliteAdapter = new PrismaBetterSqlite3({
  url: resolve('./dev.db'),
});

let prisma: PrismaClient;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient({ adapter: sqliteAdapter });
} else {
  // @ts-ignore
  if (!global.prisma) {
    // @ts-ignore
    global.prisma = new PrismaClient({ adapter: sqliteAdapter });
  }
  // @ts-ignore
  prisma = global.prisma;
}

export { prisma };