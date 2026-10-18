import type { Express, Request } from 'express';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Database } from '../db.js';
import { canAdmin, clearCookies, hash, HttpError } from '../auth.js';
import { createMailSender, smtpConfigured, type MailSender } from '../mail.js';
import { id, now } from '../seed.js';

export const activeMembership = (alias = 'm') =>
  `NOT EXISTS (SELECT 1 FROM member_deactivations md WHERE md.workspace_id=${alias}.workspace_id AND md.user_id=${alias}.user_id)`;
export async function requireActiveMember(
  db: Database,
  workspaceId: string,
  userId: string,
  status = 400,
) {
  const member = await db.one(
    'SELECT m.user_id FROM memberships m WHERE m.workspace_id=? AND m.user_id=? AND ' +
      activeMembership(),
    [workspaceId, userId],
  );
  if (!member) throw new HttpError(status, 'Choose an active workspace member.');
}
export function createAccounts(db: Database, send: MailSender = createMailSender()) {
  const pending = new Set<Promise<void>>();
  const deliver = async (userId: string, kind: string, subject: string, text: string) => {
    const user = await db.one<{ email: string }>('SELECT email FROM users WHERE id=?', [userId]);
    if (!user) return;
    const deliveryId = id();
    await db.insert('mail_deliveries', {
      id: deliveryId,
      user_id: userId,
      kind,
      state: 'queued',
      error_code: '',
      created_at: now(),
      updated_at: now(),
    });
    db.afterCommit(() => {
      const job = (async () => {
        try {
          await send({ to: user.email, subject, text });
          await db.run('UPDATE mail_deliveries SET state=?,updated_at=? WHERE id=?', [
            'sent',
            now(),
            deliveryId,
          ]);
        } catch (error) {
          const code = String((error as { code?: string }).code || 'DELIVERY_FAILED')
            .replace(/[^A-Z0-9_]/gi, '')
            .slice(0, 80);
          await db.run('UPDATE mail_deliveries SET state=?,error_code=?,updated_at=? WHERE id=?', [
            'failed',
            code,
            now(),
            deliveryId,
          ]);
        }
      })();
      pending.add(job);
      void job.finally(() => pending.delete(job)).catch(() => {});
    });
  };
  const issueToken = async (userId: string, purpose: 'verify' | 'reset', force = false) => {
    const token = randomBytes(32).toString('hex');
    const issued = await db.transaction(async () => {
      await db.run('UPDATE users SET name=name WHERE id=?', [userId]);
      const recent = await db.one(
        'SELECT id FROM account_tokens WHERE user_id=? AND purpose=? AND created_at>?',
        [userId, purpose, new Date(Date.now() - 60000).toISOString()],
      );
      if (recent && !force) return false;
      await db.run(
        'UPDATE account_tokens SET consumed_at=? WHERE user_id=? AND purpose=? AND consumed_at IS NULL',
        [now(), userId, purpose],
      );
      await db.insert('account_tokens', {
        id: id(),
        user_id: userId,
        purpose,
        token_hash: hash(token),
        expires_at: new Date(
          Date.now() + (purpose === 'reset' ? 30 * 60000 : 24 * 3600000),
        ).toISOString(),
        created_at: now(),
      });
      return true;
    });
    if (issued) {
      const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:5173';
      await deliver(
        userId,
        purpose,
        purpose === 'verify' ? 'Verify your Grace email' : 'Reset your Grace password',
        `${purpose === 'verify' ? 'Verify your email address' : 'Choose a new password'} using this one-time link:\n${origin}/account/${purpose}#token=${token}\n\nThis link expires in ${purpose === 'reset' ? '30 minutes' : '24 hours'}. If you did not request it, you can ignore this email.`,
      );
    }
  };
  const consume = async (token: string, purpose: 'verify' | 'reset', passwordHash?: string) =>
    db.transaction(async () => {
      const record = await db.one<{ id: string; user_id: string }>(
        'SELECT id,user_id FROM account_tokens WHERE token_hash=? AND purpose=? AND consumed_at IS NULL AND expires_at>?',
        [hash(token), purpose, now()],
      );
      if (!record)
        throw new HttpError(
          400,
          'This link is invalid, expired, or already used.',
          'INVALID_TOKEN',
        );
      await db.run('UPDATE users SET name=name WHERE id=?', [record.user_id]);
      if (
        !(await db.run(
          'UPDATE account_tokens SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>?',
          [now(), record.id, now()],
        ))
      )
        throw new HttpError(400, 'This link has already been used.', 'INVALID_TOKEN');
      if (purpose === 'verify') {
        if (await db.one('SELECT user_id FROM account_security WHERE user_id=?', [record.user_id]))
          await db.run('UPDATE account_security SET verified_at=? WHERE user_id=?', [
            now(),
            record.user_id,
          ]);
        else await db.insert('account_security', { user_id: record.user_id, verified_at: now() });
      } else {
        await db.run('UPDATE users SET password_hash=? WHERE id=?', [
          passwordHash!,
          record.user_id,
        ]);
        await db.run('DELETE FROM sessions WHERE user_id=?', [record.user_id]);
        await db.run(
          'UPDATE account_tokens SET consumed_at=? WHERE user_id=? AND purpose=? AND consumed_at IS NULL',
          [now(), record.user_id, 'reset'],
        );
      }
    });
  return { issueToken, consume, deliver, flush: () => Promise.all([...pending]) };
}
export type Accounts = ReturnType<typeof createAccounts>;
export function registerPublicAccountRoutes(
  app: Express,
  db: Database,
  accounts: Accounts,
  revokeUser?: (userId: string, workspaceId?: string) => void,
) {
  const limit = rateLimit({
    windowMs: 15 * 60000,
    limit: 12,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const tokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
  app.post('/api/v1/auth/forgot-password', limit, async (req, res) => {
    const started = Date.now();
    const { email } = z
      .object({ email: z.email().transform((s) => s.toLowerCase()) })
      .parse(req.body);
    const user = await db.one<{ id: string }>('SELECT id FROM users WHERE email=?', [email]);
    if (user) await accounts.issueToken(user.id, 'reset');
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 200 - (Date.now() - started))));
    res.json({ ok: true, message: 'If an account matches this email, a reset link will be sent.' });
  });
  app.post('/api/v1/auth/reset-password', limit, async (req, res) => {
    const body = tokenSchema.extend({ password: z.string().min(10).max(128) }).parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, 12);
    const identity = await db.one<{ user_id: string }>(
      'SELECT user_id FROM account_tokens WHERE token_hash=? AND purpose=?',
      [hash(body.token), 'reset'],
    );
    await accounts.consume(body.token, 'reset', passwordHash);
    if (identity) revokeUser?.(identity.user_id);
    clearCookies(res);
    res.json({ ok: true });
  });
  app.post('/api/v1/auth/verify-email', limit, async (req, res) => {
    await accounts.consume(tokenSchema.parse(req.body).token, 'verify');
    res.json({ ok: true });
  });
}
export function registerAccountRoutes(ctx: {
  app: Express;
  db: Database;
  accounts: Accounts;
  audit: (req: Request, action: string, target: string, detail?: string) => Promise<void>;
  broadcast: (req: Request) => void;
  revokeUser?: (userId: string, workspaceId?: string) => void;
}) {
  const { app, db, accounts, audit, broadcast } = ctx;
  app.get('/api/v1/account/security', async (req, res) => {
    const security = await db.one<{ verified_at: string | null }>(
      'SELECT verified_at FROM account_security WHERE user_id=?',
      [req.user.id],
    );
    res.json({
      email: req.user.email,
      verified_at: security?.verified_at || null,
      smtp_configured: smtpConfigured(),
      deliveries: await db.all(
        'SELECT id,kind,state,error_code,created_at,updated_at FROM mail_deliveries WHERE user_id=? ORDER BY created_at DESC LIMIT 20',
        [req.user.id],
      ),
    });
  });
  app.post('/api/v1/account/verification', async (req, res) => {
    const verified = await db.one(
      'SELECT user_id FROM account_security WHERE user_id=? AND verified_at IS NOT NULL',
      [req.user.id],
    );
    if (!verified) await accounts.issueToken(req.user.id, 'verify');
    res.json({ ok: true });
  });
  app.get('/api/v1/administration/members', async (req, res) => {
    canAdmin(req);
    res.json(
      await db.all(
        'SELECT u.id,u.name,u.email,u.color,m.role,md.created_at AS deactivated_at FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN member_deactivations md ON md.workspace_id=m.workspace_id AND md.user_id=m.user_id WHERE m.workspace_id=? ORDER BY u.name',
        [req.workspaceId],
      ),
    );
  });
  app.post('/api/v1/members/:id/:state', async (req, res) => {
    canAdmin(req);
    const state = z.enum(['deactivate', 'reactivate']).parse(req.params.state);
    const userId = String(req.params.id);
    if (userId === req.user.id)
      throw new HttpError(409, 'You cannot deactivate your own membership.');
    await db.transaction(async () => {
      await db.run('UPDATE users SET name=name WHERE id=?', [userId]);
      await db.run('UPDATE memberships SET role=role WHERE workspace_id=? AND user_id=?', [
        req.workspaceId,
        userId,
      ]);
      const member = await db.one<{ role: string }>(
        'SELECT role FROM memberships WHERE workspace_id=? AND user_id=?',
        [req.workspaceId, userId],
      );
      if (!member) throw new HttpError(404, 'Workspace member not found.');
      if (member.role === 'owner')
        throw new HttpError(409, 'Workspace ownership must be transferred before deactivation.');
      if (state === 'deactivate') {
        if (
          !(await db.one(
            'SELECT user_id FROM member_deactivations WHERE workspace_id=? AND user_id=?',
            [req.workspaceId, userId],
          ))
        )
          await db.insert('member_deactivations', {
            workspace_id: req.workspaceId,
            user_id: userId,
            actor_id: req.user.id,
            created_at: now(),
          });
        await db.run('DELETE FROM sessions WHERE workspace_id=? AND user_id=?', [
          req.workspaceId,
          userId,
        ]);
      } else
        await db.run('DELETE FROM member_deactivations WHERE workspace_id=? AND user_id=?', [
          req.workspaceId,
          userId,
        ]);
      await audit(req, `member.${state}`, userId);
    });
    if (state === 'deactivate') ctx.revokeUser?.(userId, req.workspaceId);
    broadcast(req);
    res.json({ ok: true });
  });
}
