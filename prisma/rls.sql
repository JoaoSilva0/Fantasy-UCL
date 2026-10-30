-- Supabase: a app acede à BD apenas pelo servidor (Prisma, role "postgres").
-- Ativar RLS sem políticas bloqueia qualquer acesso direto com as chaves anon/authenticated (PostgREST),
-- garantindo que dados de ligas privadas nunca são lidos fora das verificações de membro da app.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tablename);
  END LOOP;
END $$;
-- Nota: FORCE aplica RLS também ao dono da tabela; o role "postgres" do Supabase tem BYPASSRLS.
-- Se a app usar outro role sem BYPASSRLS, remover a linha FORCE.
