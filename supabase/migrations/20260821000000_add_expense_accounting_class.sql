ALTER TABLE public.expense_categories
ADD COLUMN accounting_class TEXT NOT NULL DEFAULT 'opex'
CONSTRAINT expense_categories_accounting_class_check
CHECK (accounting_class IN ('opex', 'capex'));

UPDATE public.expense_categories
SET accounting_class = CASE WHEN name = 'Investment' THEN 'capex' ELSE 'opex' END;
