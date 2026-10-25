import { describe, expect, it } from 'vitest';
import {
  buildEventEmailHtml,
  buildGuildEmailHtml,
  buildWaitlistEmailHtml,
  escapeHtml,
  formatEventWhen,
  renderDdSubmissionEmail,
  renderEventRegistrationEmail,
  renderGuildPurchaseEmail,
  renderWaitlistEmail,
  type EventEmailPayload,
  type GuildPurchaseEmailPayload,
  type WaitlistEmailPayload,
} from './email-templates';

const UPI = { id: 'suranjanadatta24-1@okaxis', payee_name: 'Board Game Company' };

function eventPayload(overrides: Partial<EventEmailPayload> = {}): EventEmailPayload {
  return {
    to: 'asha@example.com',
    name: 'Test Person',
    event: {
      name: 'Witching Hours',
      date: '2026-10-31T12:30:00+00:00',
      end_date: null,
      is_all_day: false,
      venue_name: 'Don’t Tell Mama',
      venue_area: 'HSR Layout',
      price_includes: 'Includes ₹150 redeemable at the venue for a spooky dinner 👻',
    },
    seats: 1,
    total_amount: 450,
    discount_applied: null,
    custom_questions: [],
    upi: UPI,
    payment_url: 'https://boardgamecompany.in/pay?amount=450&for=Witching%20Hours',
    ...overrides,
  };
}

function waitlistPayload(overrides: Partial<WaitlistEmailPayload> = {}): WaitlistEmailPayload {
  return {
    to: 'mira@example.com',
    name: 'Mira',
    seats: 1,
    event: {
      name: 'Mind Games',
      date: '2026-10-25T07:30:00+00:00',
      end_date: null,
      is_all_day: false,
      venue_name: 'Nothing before Coffee',
      venue_area: 'Koramangala',
    },
    ...overrides,
  };
}

function guildPayload(overrides: Partial<GuildPurchaseEmailPayload> = {}): GuildPurchaseEmailPayload {
  return {
    to: 'kiran@example.com',
    name: 'Kiran',
    tier_key: 'adventurer',
    tier_name: 'Adventurer',
    period_months: 3,
    starts_at: '2026-10-23',
    expires_at: '2027-01-23',
    total_amount: 1500,
    upi: UPI,
    payment_url: 'https://boardgamecompany.in/pay?amount=1500&for=Adventurer%20(Guild%20Path)',
    ...overrides,
  };
}

describe('formatEventWhen', () => {
  const when = (date: string, end_date: string | null = null, is_all_day = false) =>
    formatEventWhen({ date, end_date, is_all_day });

  it('formats a single slot in Bangalore time', () => {
    expect(when('2026-10-31T12:30:00+00:00')).toEqual({ dateStr: 'Sat, 31 Oct 2026', timeStr: '6:00 PM' });
    expect(when('2026-07-19T19:00:00+05:30')).toEqual({ dateStr: 'Sun, 19 Jul 2026', timeStr: '7:00 PM' });
  });

  it('rolls over to the next day when the UTC date is still the previous one', () => {
    expect(when('2026-01-01T18:45:00+00:00')).toEqual({ dateStr: 'Fri, 2 Jan 2026', timeStr: '12:15 AM' });
  });

  it('writes midnight and noon the way Java did', () => {
    expect(when('2026-03-10T18:30:00+00:00').timeStr).toBe('12:00 AM');
    expect(when('2026-06-15T06:30:00+00:00').timeStr).toBe('12:00 PM');
  });

  it('shows a same-day end time only when it differs from the start', () => {
    expect(when('2026-02-28T13:00:00+00:00', '2026-02-28T16:00:00+00:00')).toEqual({
      dateStr: 'Sat, 28 Feb 2026',
      timeStr: '6:30 PM – 9:30 PM',
    });
    expect(when('2026-11-14T10:00:00+00:00', '2026-11-14T10:00:00+00:00').timeStr).toBe('3:30 PM');
  });

  it('formats multi-day ranges within a month, across months and across years', () => {
    expect(when('2026-09-05T13:30:00+00:00', '2026-09-07T16:30:00+00:00')).toEqual({
      dateStr: '5 – 7 Sep 2026',
      timeStr: '7:00 PM – 10:00 PM',
    });
    expect(when('2026-09-28T04:30:00+00:00', '2026-10-02T12:30:00+00:00', true)).toEqual({
      dateStr: '28 Sep – 2 Oct 2026',
      timeStr: 'All day',
    });
    expect(when('2026-12-30T00:00:00+05:30', '2027-01-02T00:00:00+05:30', true)).toEqual({
      dateStr: '30 Dec 2026 – 2 Jan 2027',
      timeStr: 'All day',
    });
  });

  it('labels a single all-day event', () => {
    expect(when('2026-08-15T00:00:00+05:30', null, true)).toEqual({ dateStr: 'Sat, 15 Aug 2026', timeStr: 'All day' });
  });

  it('uses Java month abbreviations (Sep, not Sept) for every month', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    months.forEach((m, i) => {
      const iso = `2026-${String(i + 1).padStart(2, '0')}-10T12:00:00+05:30`;
      expect(when(iso).dateStr).toContain(` ${m} 2026`);
    });
  });

  it('never uses the narrow no-break space Intl puts before AM/PM', () => {
    const { timeStr } = when('2026-02-28T13:00:00+00:00', '2026-02-28T16:00:00+00:00');
    expect(timeStr).not.toMatch(/ /);
  });

  it('throws on an unreadable date instead of rendering NaN', () => {
    expect(() => when('not a date')).toThrow(RangeError);
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;',
    );
  });
});

describe('event registration email', () => {
  it('matches the HTML the Apps Script sent, byte for byte', () => {
    // Same structure as a real confirmation sent 2026-10-22, with the name
    // swapped for a test one. Parity with the script was checked against it.
    expect(buildEventEmailHtml(eventPayload())).toBe(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>You are registered</title></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:Verdana,Geneva,sans-serif;color:#1A1A1A;"><table style="width:100%;border-collapse:collapse;background:#f5f5f5;padding:24px 0;"><tr><td align="center"><table style="width:100%;max-width:600px;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;"><tr><td style="background:#F47B20;padding:20px 24px;"><div style="color:#fff;font-family:Verdana,Geneva,sans-serif;font-weight:900;font-size:20px;letter-spacing:1px;">Board Game Company</div></td></tr><tr><td style="padding:32px 24px;"><div style="font-family:Verdana,Geneva,sans-serif;font-weight:900;font-size:28px;line-height:1.2;color:#1A1A1A;margin-bottom:24px;">You\'re registered, Test Person!</div><table style="width:100%;border-collapse:collapse;background:#FFF8F0;border:2px solid #1A1A1A;border-radius:8px;"><tr><td style="padding:20px;"><div style="font-family:Verdana,Geneva,sans-serif;font-weight:900;font-size:20px;color:#1A1A1A;margin-bottom:8px;">Witching Hours</div><div style="color:#1A1A1A;font-size:15px;margin-bottom:4px;">Sat, 31 Oct 2026 · 6:00 PM</div><div style="color:#1A1A1A;font-size:15px;margin-bottom:4px;">Don’t Tell Mama · HSR Layout</div><div style="color:#1A1A1A;font-size:15px;">1 seat</div><div style="color:#666;font-size:14px;margin-top:8px;">Includes ₹150 redeemable at the venue for a spooky dinner 👻</div></td></tr></table><div style="font-family:Verdana,Geneva,sans-serif;font-weight:900;font-size:22px;color:#F47B20;margin:24px 0 0 0;">Total: ₹450</div><table style="width:100%;border-collapse:collapse;margin:24px 0;background:#FFF8F0;border:2px solid #1A1A1A;border-radius:8px;"><tr><td style="padding:20px;"><div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:8px;">If you haven\'t paid yet</div><div style="font-family:monospace;font-size:15px;color:#1A1A1A;margin-bottom:4px;">UPI: suranjanadatta24-1@okaxis</div><div style="font-family:monospace;font-size:15px;color:#1A1A1A;margin-bottom:16px;">Amount: ₹450</div><a href="https://boardgamecompany.in/pay?amount=450&for=Witching%20Hours" style="display:inline-block;background:#F47B20;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;font-size:15px;">Complete payment</a><div style="color:#999;font-size:13px;margin-top:12px;">Already paid? You can ignore this section.</div></td></tr></table><div style="color:#666;font-size:14px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">Questions? Reply to this email or WhatsApp <a href="https://wa.me/919606598024" style="color:#F47B20;">+91 96065 98024</a>.</div><div style="color:#666;font-size:14px;margin-top:8px;">You can buy games and more from <a href="https://boardgamecompany.in/store" style="color:#F47B20;">BGC\'s store</a>.</div><div style="color:#999;font-size:13px;margin-top:8px;">— BGC · Bangalore\'s board gaming community</div></td></tr></table></td></tr></table></body></html>',
    );
  });

  it('shows a free booking as Free (Guild Path) with no payment block', () => {
    const html = buildEventEmailHtml(eventPayload({ total_amount: 0 }));
    expect(html).toContain('Total: Free (Guild Path)');
    expect(html).not.toContain('If you haven');
    expect(html).not.toContain('UPI:');
  });

  it('keeps the UPI details but drops the button when there is no payment link', () => {
    const html = buildEventEmailHtml(eventPayload({ payment_url: '' }));
    expect(html).toContain('UPI: suranjanadatta24-1@okaxis');
    expect(html).not.toContain('Complete payment');
    expect(html).not.toContain('Already paid?');
  });

  it('lists only answered questions, escaped, with true shown as "true"', () => {
    const html = buildEventEmailHtml(eventPayload({
      custom_questions: [
        { id: 'a', label: 'Experience <level>', answer: 'New & keen' },
        { id: 'b', label: 'Need a teach?', answer: true },
        { id: 'c', label: 'Unticked', answer: false },
        { id: 'd', label: 'Blank', answer: '' },
      ],
    }));
    expect(html).toContain('Your selections');
    expect(html).toContain('Experience &lt;level&gt;</td>');
    expect(html).toContain('>New &amp; keen</td>');
    expect(html).toContain('>true</td>');
    expect(html).not.toContain('Unticked');
    expect(html).not.toContain('Blank');
  });

  it('omits the selections block when nothing was answered', () => {
    const html = buildEventEmailHtml(eventPayload({ custom_questions: [{ id: 'c', label: 'Unticked', answer: false }] }));
    expect(html).not.toContain('Your selections');
  });

  it('escapes the name, event and venue, but leaves the payment link as built', () => {
    const html = buildEventEmailHtml(eventPayload({
      name: '<b>Ravi</b>',
      event: { ...eventPayload().event, name: 'Catan & Co', venue_area: null, price_includes: null },
    }));
    expect(html).toContain("You're registered, &lt;b&gt;Ravi&lt;/b&gt;!");
    expect(html).toContain('>Catan &amp; Co</div>');
    expect(html).toContain('>Don’t Tell Mama</div>');
    expect(html).toContain('href="https://boardgamecompany.in/pay?amount=450&for=Witching%20Hours"');
  });

  it('pluralises seats', () => {
    expect(buildEventEmailHtml(eventPayload({ seats: 3 }))).toContain('>3 seats</div>');
  });

  it('uses the script subject and addresses the registrant', () => {
    const email = renderEventRegistrationEmail(eventPayload());
    expect(email.subject).toBe("[BGC] You're registered for Witching Hours!");
    expect(email.to).toEqual(['asha@example.com']);
    expect(email.text).toBeUndefined();
  });
});

describe('waitlist email', () => {
  it('mentions the seat count only for more than one seat', () => {
    expect(buildWaitlistEmailHtml(waitlistPayload({ seats: 1 }))).toContain('added you to the waitlist. We');
    expect(buildWaitlistEmailHtml(waitlistPayload({ seats: 0 }))).toContain('added you to the waitlist. We');
    expect(buildWaitlistEmailHtml(waitlistPayload({ seats: 3 }))).toContain('added you to the waitlist for 3 seats. We');
  });

  it('shows the event date and venue, and needs no payment', () => {
    const html = buildWaitlistEmailHtml(waitlistPayload());
    expect(html).toContain('>Sun, 25 Oct 2026 · 1:00 PM</div>');
    expect(html).toContain('>Nothing before Coffee · Koramangala</div>');
    expect(html).toContain('No payment needed unless a spot is confirmed.');
  });

  it('uses the script subject', () => {
    expect(renderWaitlistEmail(waitlistPayload()).subject).toBe("[BGC] You're on the waitlist for Mind Games");
  });
});

describe('Guild purchase email', () => {
  it('shows the period and the Bangalore expiry date in full', () => {
    expect(buildGuildEmailHtml(guildPayload())).toContain('>3 months · valid until 23 January 2027</div>');
    expect(buildGuildEmailHtml(guildPayload({ period_months: 1, expires_at: '2026-09-30' }))).toContain(
      '>1 month · valid until 30 September 2026</div>',
    );
  });

  it('asks for payment only when something is owed', () => {
    expect(buildGuildEmailHtml(guildPayload())).toContain('Amount: ₹1500');
    const free = buildGuildEmailHtml(guildPayload({ total_amount: 0 }));
    expect(free).toContain('Total: ₹0');
    expect(free).not.toContain('If you haven');
  });

  it('uses the script subject', () => {
    expect(renderGuildPurchaseEmail(guildPayload()).subject).toBe('[BGC] Welcome to the Guild — Adventurer!');
  });
});

describe("Demon's Draft submission email", () => {
  const dd = {
    to: ['one@example.com', 'two@example.com'],
    name: 'Zoë',
    phone: '9876543210',
    email: 'zoe@example.com',
    script_json: [{ id: '_meta', name: 'Démons — “Draft” ✨' }, 'washerwoman'],
    submission_id: 'abc-123',
  };

  it('is a plain-text email to every recipient', () => {
    const email = renderDdSubmissionEmail(dd);
    expect(email.to).toEqual(['one@example.com', 'two@example.com']);
    expect(email.subject).toBe("Demon's Draft submission — Zoë");
    expect(email.html).toBeUndefined();
    expect(email.text).toBe(
      "New Demon's Draft script submission.\n\n" +
      'Name: Zoë\nPhone: 9876543210\nEmail: zoe@example.com\nSubmission ID: abc-123\n\n' +
      'Script JSON is attached and included below.\n\n' +
      JSON.stringify(dd.script_json, null, 2),
    );
  });

  it('attaches the script as UTF-8 JSON', () => {
    const [attachment] = renderDdSubmissionEmail(dd).attachments ?? [];
    expect(attachment.filename).toBe('script-abc-123.json');
    const bytes = Uint8Array.from(atob(attachment.content), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(JSON.stringify(dd.script_json, null, 2));
  });

  it('falls back to the default recipient when none are given', () => {
    expect(renderDdSubmissionEmail({ ...dd, to: [] }).to).toEqual(['boardgamecompany2024@gmail.com']);
  });
});
