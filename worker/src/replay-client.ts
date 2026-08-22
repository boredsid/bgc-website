import type { Env } from './index';

export interface ReplayPassStatus {
  has_pass: boolean;
  edition_slug: string | null;
  edition_name: string | null;
  pass_type: 'oneshot' | 'campaign' | null;
  days: string[];
}

export const NO_REPLAY_PASS: ReplayPassStatus = {
  has_pass: false,
  edition_slug: null,
  edition_name: null,
  pass_type: null,
  days: [],
};

/**
 * Ask the REPLAY worker whether this phone holds a confirmed pass for the
 * latest REPLAY edition. Mirrors REPLAY's own call to /api/guild-status here
 * and shares the same REPLAY_TO_BGC_SECRET.
 *
 * Any failure resolves to "no pass": a REPLAY outage must not hand out free
 * seats, and it must not block the registration either.
 */
export async function fetchReplayPassStatus(env: Env, phone: string): Promise<ReplayPassStatus> {
  if (!env.REPLAY_WORKER_URL || !env.REPLAY_TO_BGC_SECRET || !phone) return NO_REPLAY_PASS;
  try {
    const res = await fetch(`${env.REPLAY_WORKER_URL}/api/pass-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.REPLAY_TO_BGC_SECRET}`,
      },
      body: JSON.stringify({ phone }),
    });
    if (!res.ok) return NO_REPLAY_PASS;
    const body = (await res.json()) as Partial<ReplayPassStatus>;
    return { ...NO_REPLAY_PASS, ...body, has_pass: body.has_pass === true };
  } catch {
    return NO_REPLAY_PASS;
  }
}
