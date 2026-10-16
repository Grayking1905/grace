import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { Database } from './db.js';
import type { User } from '../shared/types.js';
import { id, now } from './seed.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'REQUEST_FAILED',
  ) {
    super(message);
  }
}
declare global {
  namespace Express {
    interface Request {
      user: User;
      workspaceId: string;
      sessionId: string;
    }
  }
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const production = process.env.NODE_ENV === 'production';
if (production && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32))
  throw new Error('Set JWT_SECRET to at least 32 random characters.');
export const jwtSecret = process.env.JWT_SECRET || randomBytes(48).toString('hex');
const cookieOptions = {
  httpOnly: true,
  secure: production,
  sameSite: 'strict' as const,
  path: '/',
};
export function accessCookie(
  res: Response,
  userId: string,
  workspaceId: string,
  sessionId: string,
) {
  res.cookie(
    'grace_access',
    jwt.sign({ sub: userId, wid: workspaceId, sid: sessionId }, jwtSecret, {
      expiresIn: '15m',
      issuer: 'grace',
      audience: 'grace-web',
    }),
    { ...cookieOptions, maxAge: 15 * 60 * 1000 },
  );
}
export async function createSession(
  db: Database,
  res: Response,
  userId: string,
  workspaceId: string,
) {
  return db.transaction(async()=>{
  await db.run('UPDATE users SET name=name WHERE id=?',[userId]);
  await db.run('UPDATE memberships SET role=role WHERE workspace_id=? AND user_id=?',[workspaceId,userId]);
  if (
    !(await db.one(
      'SELECT m.user_id FROM memberships m WHERE m.user_id=? AND m.workspace_id=? AND NOT EXISTS (SELECT 1 FROM member_deactivations md WHERE md.workspace_id=m.workspace_id AND md.user_id=m.user_id)',
      [userId, workspaceId],
    ))
  )
    throw new HttpError(403, 'This membership is inactive.');
  const refresh = randomBytes(48).toString('hex');
  const sessionId = id();
  await db.insert('sessions', {
    id: sessionId,
    user_id: userId,
    workspace_id: workspaceId,
    refresh_hash: hash(refresh),
    expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    created_at: now(),
  });
  accessCookie(res, userId, workspaceId, sessionId);
  res.cookie('grace_refresh', refresh, {
    ...cookieOptions,
    maxAge: 7 * 86400_000,
  });
  });
}
export function clearCookies(res: Response) {
  res.clearCookie('grace_access', cookieOptions);
  res.clearCookie('grace_refresh', cookieOptions);
}
export function decodeAccess(token: string) {
  return jwt.verify(token, jwtSecret, {
    issuer: 'grace',
    audience: 'grace-web',
  }) as jwt.JwtPayload & { sub: string; wid: string; sid: string };
}
export async function resolveUser(db: Database, token?: string) {
  if (!token) throw new HttpError(401, 'Please sign in to continue.', 'UNAUTHENTICATED');
  let payload: ReturnType<typeof decodeAccess>;
  try {
    payload = decodeAccess(token);
  } catch {
    throw new HttpError(401, 'Your session has expired.', 'UNAUTHENTICATED');
  }
  const session = await db.one(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ? AND workspace_id = ? AND expires_at > ?',
    [payload.sid, payload.sub, payload.wid, now()],
  );
  if (!session) throw new HttpError(401, 'This session is no longer active.', 'UNAUTHENTICATED');
  const user = await db.one<User>(
    'SELECT u.id,u.name,u.email,u.color,u.capacity,m.role,a.verified_at FROM users u JOIN memberships m ON m.user_id = u.id LEFT JOIN account_security a ON a.user_id=u.id WHERE u.id = ? AND m.workspace_id = ? AND NOT EXISTS (SELECT 1 FROM member_deactivations md WHERE md.workspace_id=m.workspace_id AND md.user_id=m.user_id)',
    [payload.sub, payload.wid],
  );
  if (!user) throw new HttpError(403, 'You do not have access to this workspace.');
  const { verified_at, ...profile } = user as User & { verified_at: string | null };
  return {
    user: {
      ...profile,
      email_verified: !!verified_at,
      verification_required: production || process.env.AUTH_REQUIRE_VERIFIED === 'true',
    },
    workspaceId: payload.wid,
    sessionId: payload.sid,
  };
}
export const authenticate =
  (db: Database) => async (req: Request, _res: Response, next: NextFunction) => {
    try {
      Object.assign(req, await resolveUser(db, req.cookies.grace_access));
      next();
    } catch (e) {
      next(e);
    }
  };
export function canWrite(req: Request) {
  if (req.user.verification_required && !req.user.email_verified)
    throw new HttpError(403, 'Verify your email before making changes.', 'EMAIL_UNVERIFIED');
  if (req.user.role === 'viewer')
    throw new HttpError(403, 'Viewers can browse work but cannot make changes.', 'FORBIDDEN');
}
export function canAdmin(req: Request) {
  canWrite(req);
  if (!['owner', 'admin'].includes(req.user.role))
    throw new HttpError(403, 'A workspace administrator must make this change.', 'FORBIDDEN');
}
export async function rotateSession(db: Database, req: Request, res: Response) {
  const refresh = req.cookies.grace_refresh;
  if (!refresh) throw new HttpError(401, 'Please sign in again.');
  await db.transaction(async () => {
    const currentHash = hash(refresh);
    const session = await db.one<{
      id: string;
      user_id: string;
      workspace_id: string;
    }>('SELECT * FROM sessions WHERE refresh_hash = ? AND expires_at > ?', [currentHash, now()]);
    if (!session) throw new HttpError(401, 'Your session has expired.');
    const nextToken = randomBytes(48).toString('hex');
    const changed = await db.run(
      'UPDATE sessions SET refresh_hash = ? WHERE id = ? AND refresh_hash = ?',
      [hash(nextToken), session.id, currentHash],
    );
    if (!changed) throw new HttpError(401, 'This session has already been refreshed.');
    accessCookie(res, session.user_id, session.workspace_id, session.id);
    res.cookie('grace_refresh', nextToken, {
      ...cookieOptions,
      maxAge: 7 * 86400_000,
    });
  });
}
