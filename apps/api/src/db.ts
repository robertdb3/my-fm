import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __PRISMA_CLIENT__: PrismaClient | undefined;
}

export const prisma =
  globalThis.__PRISMA_CLIENT__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__PRISMA_CLIENT__ = prisma;
}
