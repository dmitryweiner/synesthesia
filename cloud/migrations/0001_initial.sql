-- Shared points (PLAN.md decision 9): id = first 10 base62 chars of SHA-256
-- of the canonical JSON body, so rows are immutable and naturally deduped.
-- Quotas apply to NEW points only: re-sharing an existing point always works.
-- (CASE ... END is parenthesized inside triggers: wrangler's statement
-- splitter would otherwise take "END;" for the end of the trigger.)
CREATE TABLE points (
 id TEXT PRIMARY KEY,
 body TEXT NOT NULL,
 bytes INTEGER NOT NULL,
 created REAL NOT NULL
);
-- statement-breakpoint
CREATE TABLE daily (day INTEGER PRIMARY KEY, count INTEGER NOT NULL);
-- statement-breakpoint
CREATE TABLE usage (id INTEGER PRIMARY KEY CHECK(id=1), points INTEGER NOT NULL, bytes INTEGER NOT NULL);
-- statement-breakpoint
INSERT INTO usage VALUES (1, 0, 0);
-- statement-breakpoint
CREATE TRIGGER points_quota BEFORE INSERT ON points
WHEN NOT EXISTS (SELECT 1 FROM points WHERE id = NEW.id)
BEGIN
 SELECT (CASE WHEN COALESCE((SELECT count FROM daily WHERE day = CAST(NEW.created / 86400 AS INTEGER)), 0) >= 5000
   THEN RAISE(ABORT, 'points_quota') END);
 SELECT (CASE WHEN (SELECT points FROM usage WHERE id = 1) >= 500000
   THEN RAISE(ABORT, 'points_quota') END);
END;
-- statement-breakpoint
CREATE TRIGGER points_count AFTER INSERT ON points BEGIN
 INSERT INTO daily VALUES (CAST(NEW.created / 86400 AS INTEGER), 1)
 ON CONFLICT(day) DO UPDATE SET count = count + 1;
 UPDATE usage SET points = points + 1, bytes = bytes + NEW.bytes WHERE id = 1;
END;
