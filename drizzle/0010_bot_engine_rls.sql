-- RLS for the bot execution engine tables (server-only access, same as 0001).
ALTER TABLE bot_signals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bot_executions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bot_positions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE engine_locks ENABLE ROW LEVEL SECURITY;
