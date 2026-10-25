// Sends one real email of each kind through Resend, to check the domain, the
// API key and how the emails look in a real inbox. Skipped unless
// RESEND_LIVE_TEST=1, so `npm test` never sends anything. Run it from a shell
// that reads the key without echoing it (see AGENTS.md → Email):
//
//   ( read -rs "RESEND_API_KEY?Resend key: "; export RESEND_API_KEY; \
//     RESEND_LIVE_TEST=1 TEST_TO=you@example.com npx vitest run src/email.live.test.ts )
//
// Failure messages show only the Resend status and error, never request
// headers, so the key can't end up in the output.
import { describe, expect, it } from 'vitest';
import { sendViaResend } from './resend';
import {
  renderDdSubmissionEmail,
  renderEventRegistrationEmail,
  renderGuildPurchaseEmail,
  renderWaitlistEmail,
  type RenderedEmail,
} from './email-templates';

const LIVE = process.env.RESEND_LIVE_TEST === '1';
const KEY = process.env.RESEND_API_KEY ?? '';
const TO = process.env.TEST_TO ?? '';

const UPI = { id: 'suranjanadatta24-1@okaxis', payee_name: 'Board Game Company' };

function samples(): Array<[string, RenderedEmail, string]> {
  return [
    ['paid registration', renderEventRegistrationEmail({
      to: TO, name: '[TEST] Cutover',
      event: {
        name: '[TEST] Resend cutover', date: '2026-11-08T13:30:00+00:00', end_date: null, is_all_day: false,
        venue_name: 'Test Venue', venue_area: 'Indiranagar', price_includes: 'Snacks and one drink',
      },
      seats: 2, total_amount: 900, discount_applied: null,
      custom_questions: [{ id: 'q1', label: 'Played before?', answer: 'Yes' }],
      upi: UPI, payment_url: 'https://boardgamecompany.in/pay?amount=900&for=%5BTEST%5D%20Resend%20cutover',
    }), 'event_registration'],
    ['free registration', renderEventRegistrationEmail({
      to: TO, name: '[TEST] Cutover',
      event: {
        name: '[TEST] Free night', date: '2026-11-15T07:30:00+00:00', end_date: null, is_all_day: false,
        venue_name: 'Test Venue', venue_area: null, price_includes: null,
      },
      seats: 1, total_amount: 0, discount_applied: 'adventurer', custom_questions: [],
      upi: UPI, payment_url: 'https://boardgamecompany.in/pay?amount=0&for=%5BTEST%5D%20Free%20night',
    }), 'event_registration'],
    ['waitlist (multi-day, all day)', renderWaitlistEmail({
      to: TO, name: '[TEST] Cutover', seats: 2,
      event: {
        name: '[TEST] Weekend festival', date: '2026-09-28T00:00:00+05:30', end_date: '2026-10-02T00:00:00+05:30',
        is_all_day: true, venue_name: 'Test Venue', venue_area: 'Koramangala',
      },
    }), 'event_waitlist'],
    ['guild purchase', renderGuildPurchaseEmail({
      to: TO, name: '[TEST] Cutover', tier_key: 'adventurer', tier_name: 'Adventurer', period_months: 3,
      starts_at: '2026-10-23', expires_at: '2027-01-23', total_amount: 1500, upi: UPI,
      payment_url: 'https://boardgamecompany.in/pay?amount=1500&for=Adventurer%20(Guild%20Path)',
    }), 'guild_purchase'],
    ["Demon's Draft submission", renderDdSubmissionEmail({
      to: [TO], name: '[TEST] Cutover', phone: '0000000000', email: TO,
      submission_id: '00000000-0000-4000-8000-000000000000',
      script_json: [{ id: '_meta', name: '[TEST] Cutover script ✨', author: 'BGC' }, 'washerwoman', 'imp'],
    }), 'dd_submission'],
  ];
}

describe.skipIf(!LIVE)('live Resend send', () => {
  it('has a key and a recipient', () => {
    expect(KEY, 'RESEND_API_KEY is not set').not.toBe('');
    expect(TO, 'TEST_TO is not set').not.toBe('');
  });

  it.each(LIVE && KEY && TO ? samples() : [])('sends the %s email', async (label, email, type) => {
    const result = await sendViaResend(KEY, email, type);
    expect(result.ok, `${label}: status ${result.status ?? 'none'} ${result.error ?? ''}`).toBe(true);
  }, 20_000);
});
