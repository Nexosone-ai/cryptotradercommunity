-- Row Level Security: every table is accessed only by the server through the
-- owner role. Enabling RLS with no policies denies access to any other role
-- (e.g. Supabase anon/authenticated keys via PostgREST).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','user_roles','auth_nonces','sessions','bots','bot_versions','bot_review_logs',
    'bot_subscriptions','trading_accounts','agent_authorizations','builder_fee_approvals',
    'orders','fills','positions_snapshots','bot_performance_snapshots','partners',
    'referral_relations','fee_policy_versions','fee_events','ledger_entries','payouts',
    'admin_audit_logs','risk_events','rate_limit_buckets'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Ledger and audit log are append-only.
CREATE OR REPLACE FUNCTION ctc_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ctc_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER admin_audit_logs_append_only BEFORE UPDATE OR DELETE ON admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION ctc_reject_mutation();
--> statement-breakpoint

-- Every journal must balance (sum of debits and credits = 0) at commit time.
CREATE OR REPLACE FUNCTION ctc_check_journal_balance() RETURNS trigger AS $$
DECLARE total numeric;
BEGIN
  SELECT coalesce(sum(amount_e8), 0) INTO total FROM ledger_entries WHERE journal_id = NEW.journal_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger journal % is unbalanced by %', NEW.journal_id, total;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ctc_check_journal_balance();
--> statement-breakpoint

-- Initial fee policy (docs/FEE_POLICY.md): owner 70% / pool 30%;
-- pool → platform 20% / partners 80%; partners → tier1 60% / tier2 40%.
INSERT INTO fee_policy_versions
  (id, version, bot_owner_share_ppm, platform_share_of_pool_ppm, tier1_share_of_partner_pool_ppm,
   effective_from, status, note)
VALUES
  ('policy-v1', 1, 700000, 200000, 600000, '2026-01-01T00:00:00Z', 'ACTIVE',
   'Initial default: 70 / 6 / 14.4 / 9.6');
