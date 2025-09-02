const { PrismaClient } = require('@prisma/client');

// Prevent multiple Prisma instances in serverless environment
let prisma;

if (!global.__prisma) {
  prisma = new PrismaClient();
  global.__prisma = prisma;
} else {
  prisma = global.__prisma;
}

module.exports = prisma;