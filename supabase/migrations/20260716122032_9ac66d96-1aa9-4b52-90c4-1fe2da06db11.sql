
CREATE TABLE public.vault_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  notes text,
  opening_balance numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_users TO authenticated;
GRANT ALL ON public.vault_users TO service_role;
ALTER TABLE public.vault_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read vault_users" ON public.vault_users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage vault_users" ON public.vault_users FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_vault_users_updated_at BEFORE UPDATE ON public.vault_users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.vault_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_user_id uuid NOT NULL REFERENCES public.vault_users(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  topup_date date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_topups TO authenticated;
GRANT ALL ON public.vault_topups TO service_role;
ALTER TABLE public.vault_topups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read vault_topups" ON public.vault_topups FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage vault_topups" ON public.vault_topups FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_vault_topups_user ON public.vault_topups(vault_user_id);
CREATE INDEX idx_vault_topups_date ON public.vault_topups(topup_date);
CREATE TRIGGER update_vault_topups_updated_at BEFORE UPDATE ON public.vault_topups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.purchases ADD COLUMN vault_user_id uuid REFERENCES public.vault_users(id) ON DELETE SET NULL;
CREATE INDEX idx_purchases_vault ON public.purchases(vault_user_id);

ALTER TABLE public.expenses ADD COLUMN vault_user_id uuid REFERENCES public.vault_users(id) ON DELETE SET NULL;
CREATE INDEX idx_expenses_vault ON public.expenses(vault_user_id);
