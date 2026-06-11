const { PrismaClient } = require('@prisma/client');

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:zUAQRcJWeYnpyVKBNutxSMBtbCdgumir@postgres.railway.internal:5432/railway';

const prisma = new PrismaClient({
  datasources: { db: { url: DB_URL } },
});

module.exports = prisma;
