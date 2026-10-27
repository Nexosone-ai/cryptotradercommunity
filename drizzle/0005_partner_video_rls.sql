-- RLS for partner video service tables (server-only access, same as 0001).
ALTER TABLE partner_credit_topups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE video_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE video_outputs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer_invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE partner_settlements ENABLE ROW LEVEL SECURITY;
