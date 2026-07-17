ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS contact_person TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS vault_user_id UUID REFERENCES public.vault_users(id) ON DELETE SET NULL;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS vault_user_id UUID REFERENCES public.vault_users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payments_vault_user ON public.payments(vault_user_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_vault_user ON public.supplier_payments(vault_user_id);