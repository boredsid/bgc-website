import React, { useState } from 'react';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

type Status = 'idle' | 'submitting' | 'success' | 'error';

const RED = '#C1272D';
const PARCHMENT = '#E8E0D0';

// Submissions close at midnight IST at the end of 15 Jun 2026 (i.e. 16 Jun 00:00 IST).
// Frontend-only soft close — the worker still accepts late posts.
const DEADLINE_MS = new Date('2026-06-16T00:00:00+05:30').getTime();

const fieldStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(232,224,208,0.25)',
  borderRadius: 8,
  color: PARCHMENT,
  padding: '0.7rem 0.85rem',
  fontSize: '0.97rem',
  fontFamily: 'Inter, sans-serif',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#FFD166',
  marginBottom: '0.35rem',
  fontWeight: 600,
};

export default function DemonsDraftForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [scriptJson, setScriptJson] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  const closed = Date.now() >= DEADLINE_MS;

  // null = empty, true = valid array, false = present but not a valid array
  const jsonValid: boolean | null = (() => {
    if (!scriptJson.trim()) return null;
    try {
      const parsed = JSON.parse(scriptJson);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  })();

  const canSubmit =
    !!name.trim() &&
    !!phone.trim() &&
    !!email.trim() &&
    jsonValid === true &&
    status !== 'submitting';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus('submitting');
    setError('');
    try {
      const res = await fetch(`${WORKER_URL}/api/dd-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, email, script_json: scriptJson }),
      });
      const data = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
      if (!res.ok || !data.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        setStatus('error');
        return;
      }
      setStatus('success');
    } catch {
      setError('Network error. Please check your connection and try again.');
      setStatus('error');
    }
  }

  if (closed) {
    return (
      <div
        style={{
          background: 'rgba(193,39,45,0.12)',
          border: `1px solid ${RED}`,
          borderRadius: 12,
          padding: '2rem',
          textAlign: 'center',
          color: PARCHMENT,
        }}
      >
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🕯️</div>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", color: '#FFD166', fontSize: '1.4rem', margin: 0 }}>
          Submissions are closed.
        </h3>
        <p style={{ marginTop: '0.75rem', opacity: 0.85 }}>
          The deadline has passed. The hosts are now assigning code names and passing the
          scripts to the judges. Thanks to everyone who entered the draft.
        </p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div
        style={{
          background: 'rgba(193,39,45,0.12)',
          border: `1px solid ${RED}`,
          borderRadius: 12,
          padding: '2rem',
          textAlign: 'center',
          color: PARCHMENT,
        }}
      >
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🕯️</div>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", color: '#FFD166', fontSize: '1.4rem', margin: 0 }}>
          Your script is in the draft.
        </h3>
        <p style={{ marginTop: '0.75rem', opacity: 0.85 }}>
          We've received your submission. The hosts will assign it a code name and pass it to the
          judges anonymously. Good luck.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1.1rem' }}>
      <div>
        <label style={labelStyle} htmlFor="dd-name">Your name</label>
        <input id="dd-name" style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Kept private — never shown to judges" autoComplete="name" />
      </div>
      <div style={{ display: 'grid', gap: '1.1rem', gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <label style={labelStyle} htmlFor="dd-phone">Phone</label>
          <input id="dd-phone" style={fieldStyle} value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="10-digit mobile number" inputMode="tel" autoComplete="tel" />
        </div>
        <div>
          <label style={labelStyle} htmlFor="dd-email">Email</label>
          <input id="dd-email" style={fieldStyle} value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com" inputMode="email" autoComplete="email" />
        </div>
      </div>
      <div>
        <label style={labelStyle} htmlFor="dd-json">Script JSON</label>
        <textarea id="dd-json" value={scriptJson} onChange={(e) => setScriptJson(e.target.value)}
          rows={8} placeholder='Paste the JSON exported from script.bloodontheclocktower.com (e.g. [{"id":"_meta",...}, "washerwoman", ...])'
          style={{ ...fieldStyle, fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem', resize: 'vertical' }} />
        {jsonValid === false && (
          <p style={{ color: '#FF8A8A', fontSize: '0.82rem', marginTop: '0.4rem' }}>
            That doesn't look like valid exported JSON yet. Use <strong>Export → JSON</strong> in the script tool and paste the whole thing.
          </p>
        )}
        {jsonValid === true && (
          <p style={{ color: '#7FD1B9', fontSize: '0.82rem', marginTop: '0.4rem' }}>
            Valid script JSON detected.
          </p>
        )}
      </div>

      {status === 'error' && (
        <p style={{ color: '#FF8A8A', fontSize: '0.9rem', margin: 0 }}>{error}</p>
      )}

      <button type="submit" disabled={!canSubmit}
        style={{
          background: canSubmit ? RED : 'rgba(193,39,45,0.4)',
          color: PARCHMENT,
          border: 'none',
          borderRadius: 8,
          padding: '0.85rem 1.2rem',
          fontSize: '1rem',
          fontWeight: 700,
          fontFamily: "'Space Grotesk', sans-serif",
          letterSpacing: '0.03em',
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          textTransform: 'uppercase',
          transition: 'background 0.15s',
        }}>
        {status === 'submitting' ? 'Submitting…' : 'Submit your script'}
      </button>
      <p style={{ fontSize: '0.8rem', opacity: 0.6, margin: 0, color: PARCHMENT }}>
        By submitting you confirm your name does not appear inside the script JSON itself.
      </p>
    </form>
  );
}
