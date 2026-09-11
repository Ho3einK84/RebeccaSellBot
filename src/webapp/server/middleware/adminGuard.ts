import type { FastifyRequest, FastifyReply } from 'fastify';

export interface WebAppSession {
  telegramId: number;
  role: 'admin' | 'user';
}

declare module 'fastify' {
  interface FastifyRequest {
    userSession?: WebAppSession;
  }
}

export async function adminGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await adminGuardWithCheck(request, reply);
}

/**
 * Admin guard with live registry re-validation.
 * The JWT `role` is only a hint: a removed admin keeps a valid signature for
 * up to 12h, so the current registry must be consulted on every request.
 */
export async function adminGuardWithCheck(
  request: FastifyRequest,
  reply: FastifyReply,
  isAdmin?: (telegramId: number) => boolean
): Promise<void> {
  try {
    let token: string | undefined = request.cookies?.session;

    if (!token && request.headers.authorization) {
      const parts = request.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0]?.toLowerCase() === 'bearer') {
        token = parts[1];
      }
    }

    if (!token) {
      await reply.code(403).send({ error: 'Forbidden' });
      return;
    }

    const decoded = (await request.server.jwt.verify(token)) as WebAppSession;
    if (!decoded || !Number.isSafeInteger(decoded.telegramId) || decoded.role !== 'admin') {
      await reply.code(403).send({ error: 'Forbidden' });
      return;
    }

    if (isAdmin && !isAdmin(decoded.telegramId)) {
      await reply.code(403).send({ error: 'Forbidden' });
      return;
    }

    request.userSession = decoded;
  } catch {
    await reply.code(403).send({ error: 'Forbidden' });
  }
}

export async function authGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    let token: string | undefined = request.cookies?.session;

    if (!token && request.headers.authorization) {
      const parts = request.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0]?.toLowerCase() === 'bearer') {
        token = parts[1];
      }
    }

    if (!token) {
      await reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const decoded = (await request.server.jwt.verify(token)) as WebAppSession;
    if (!decoded || !Number.isSafeInteger(decoded.telegramId)) {
      await reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    request.userSession = decoded;
  } catch {
    await reply.code(401).send({ error: 'Unauthorized' });
  }
}
