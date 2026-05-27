import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __db__: PrismaClient | undefined;
}

if (!global.__db__) {
  global.__db__ = new PrismaClient();
}

const prisma = global.__db__;

export default prisma;
