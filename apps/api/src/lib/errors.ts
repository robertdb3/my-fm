import type { FastifyReply } from "fastify";

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ErrorCode,
  message: string,
  details?: unknown
) {
  return reply.status(statusCode).send({
    error: {
      code,
      message,
      details
    }
  });
}
