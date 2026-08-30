import type { User } from "@prisma/client";
import { prisma } from "../db";

const LOCAL_USER_EMAIL = "local@my-fm";

let cachedUser: Promise<User> | null = null;

async function resolveLocalUser(): Promise<User> {
  const existing = await prisma.user.findFirst({
    orderBy: {
      createdAt: "asc"
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.user.create({
    data: {
      email: LOCAL_USER_EMAIL
    }
  });
}

/**
 * The app runs single-user on a private network, so every request acts as the
 * one local account. Resolved once and reused for the process lifetime.
 */
export function getLocalUser(): Promise<User> {
  if (!cachedUser) {
    cachedUser = resolveLocalUser().catch((error) => {
      cachedUser = null;
      throw error;
    });
  }

  return cachedUser;
}
