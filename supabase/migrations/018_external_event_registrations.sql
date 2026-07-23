-- Events can be listed by BGC while registrations are handled by a partner.
-- External events deliberately have no BGC pricing, capacity, questions, or
-- Guild Path gate; the public site sends people to the partner's URL.

alter table events
  add column externally_managed boolean not null default false,
  add column external_registration_url text;

alter table events
  add constraint events_external_registration_fields_check
  check (
    (
      externally_managed = false
      and external_registration_url is null
    )
    or
    (
      externally_managed = true
      and external_registration_url ~* '^https?://[^[:space:]]+$'
      and price = 0
      and capacity = 0
      and (custom_questions is null or custom_questions = '[]'::jsonb)
      and price_includes is null
      and guild_path_exclusive = false
    )
  );

comment on column events.externally_managed is
  'True when a partner, rather than BGC, owns registration and capacity.';

comment on column events.external_registration_url is
  'HTTP(S) registration URL for an externally managed event.';
