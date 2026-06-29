alter table helper_app.settlements
  add column if not exists transport_claim_note text;
