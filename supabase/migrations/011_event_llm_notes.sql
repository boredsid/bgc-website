-- Add llm_notes: freeform context surfaced to the Instagram DM agent for an event.
-- Holds things that aren't already captured by structured columns (e.g. "BYOB", "side-entrance for wheelchair access").
alter table events add column if not exists llm_notes text;
