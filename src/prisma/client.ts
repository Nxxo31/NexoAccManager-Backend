import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { resolve } from 'path';

function getDbPath() {
  // Tests can set DATABASE_URL to use a separate test db (e.g. file:./test.db)
  // When not set, fall back to dev.db for development
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.startsWith('file:')) {
    return resolve(dbUrl.replace(/^file:/, ''));
  }
  return resolve('./dev.db');
}

const sqliteAdapter = new PrismaBetterSqlite3({
  url: getDbPath(),
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