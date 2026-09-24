-- An event can point at a shared Google Photos album. When set on a published
-- event, the album appears on the public /photos page alongside the Google
-- Drive event folders, which keep working exactly as before.
--
-- Google Photos has no API for reading someone else's album, so the worker
-- reads the album's public share page. That only works for a link-shared
-- album: photos.app.goo.gl/<id>, or photos.google.com/share/<id>?key=<key>.
alter table events
  add column google_photos_url text;

alter table events
  add constraint events_google_photos_url_check
  check (
    google_photos_url is null
    or google_photos_url ~ '^https://(photos\.app\.goo\.gl/[A-Za-z0-9]+|photos\.google\.com/share/[A-Za-z0-9_-]+\?key=[A-Za-z0-9_-]+)$'
  );

comment on column events.google_photos_url is
  'Share link of a Google Photos album for this event, shown on the public Photos page.';
