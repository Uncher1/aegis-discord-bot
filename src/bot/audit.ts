import { appendFileSync } from 'node:fs';
import { logger } from '../logger.js';

const AUDIT_FILE = 'aegis-audit.log';

export interface AuditEntry {
  owner: string;
  action: string;
  target?: string;
  ok: boolean;
  detail?: string;
}

/**
 * Append-only trail of every action A.E.G.I.S actually performs. Written both
 * to a file (for after-the-fact review) and to the structured logger. Failures
 * to write the file never block the bot.
 */
export function recordAudit(entry: AuditEntry): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  try {
    appendFileSync(AUDIT_FILE, `${line}\n`, 'utf8');
  } catch (err) {
    logger.error('Audit write failed', { err: String(err) });
  }
  logger.info('AUDIT', entry);
}
