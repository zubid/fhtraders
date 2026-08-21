ALTER TABLE public.expense_categories
ADD COLUMN IF NOT EXISTS accounting_class TEXT NOT NULL DEFAULT 'opex';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expense_categories_accounting_class_check'
      AND conrelid = 'public.expense_categories'::regclass
  ) THEN
    ALTER TABLE public.expense_categories
    ADD CONSTRAINT expense_categories_accounting_class_check
    CHECK (accounting_class IN ('opex', 'capex'));
  END IF;
END
$$;

UPDATE public.expense_categories
SET accounting_class = CASE WHEN name = 'Investment' THEN 'capex' ELSE 'opex' END;
