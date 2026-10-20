-- RLS for swap tables: server-only access (same as 0001).
ALTER TABLE swap_deployments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE swap_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE swap_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE swap_fills ENABLE ROW LEVEL SECURITY;
