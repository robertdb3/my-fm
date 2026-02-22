import { prisma } from "../db";

export async function ensureUserByEmail(email: string) {
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    return existing;
  }

  return prisma.user.create({
    data: {
      email
    }
  });
}
