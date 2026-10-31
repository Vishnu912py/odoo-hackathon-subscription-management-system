-- Apply after Prisma migrations in the hosted private schema. Express enforces
-- ownership through its dedicated schema-owner connection; the Supabase Data API
-- must not have access to application sessions, tokens or billing records.
REVOKE ALL ON SCHEMA brightloop FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA brightloop FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA brightloop FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE brightloop_app IN SCHEMA brightloop REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'brightloop' LOOP
    EXECUTE format('ALTER TABLE brightloop.%I ENABLE ROW LEVEL SECURITY', item.tablename);
  END LOOP;
END $$;
