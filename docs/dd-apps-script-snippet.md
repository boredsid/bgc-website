# Demon's Draft — Apps Script email branch

The worker posts `{ type: 'dd_submission', to: [..emails..], name, phone, email, script_json, submission_id, secret }`
to `APPS_SCRIPT_URL`. Add a branch to the Apps Script's `doPost` dispatcher that handles `type === 'dd_submission'`:

```javascript
function handleDdSubmission(data) {
  var recipients = (data.to && data.to.length ? data.to : ['boardgamecompany2024@gmail.com']).join(',');
  var subject = "Demon's Draft submission — " + data.name;
  var json = JSON.stringify(data.script_json, null, 2);
  var body =
    'New Demon\'s Draft script submission.\n\n' +
    'Name: ' + data.name + '\n' +
    'Phone: ' + data.phone + '\n' +
    'Email: ' + data.email + '\n' +
    'Submission ID: ' + data.submission_id + '\n\n' +
    'Script JSON is attached and included below.\n\n' + json;

  MailApp.sendEmail({
    to: recipients,
    subject: subject,
    body: body,
    attachments: [Utilities.newBlob(json, 'application/json', 'script-' + data.submission_id + '.json')],
  });
  return { success: true };
}
```

Wire it into the existing dispatcher alongside the other `type`s, e.g.:

```javascript
if (data.type === 'dd_submission') return jsonOut(handleDdSubmission(data));
```

(Keep the existing `secret` verification that the other handlers already use.)

Then **redeploy** the Apps Script web app (Deploy → Manage deployments → new version) so the new branch goes live.

## Deploy checklist for Demon's Draft

1. Apply migration `016_dd_submissions.sql` to Supabase (ref `yhgtwqdsnrslcgdvmunz`).
2. `cd worker && npx wrangler deploy` (worker does NOT auto-deploy on push).
3. Push to `main` → Cloudflare Pages auto-deploys the site (`/dd`).
4. Paste the `dd_submission` branch into the Apps Script and redeploy it.
5. To change notification recipients later: edit `DD_SUBMISSION_EMAILS` in `worker/wrangler.toml` and redeploy the worker (comma-separated).
6. Smoke test: open `/dd`, paste a real exported script, submit; confirm a row in `dd_submissions` and an email at `boardgamecompany2024@gmail.com`.
