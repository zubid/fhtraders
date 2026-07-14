ALTER TABLE public.app_settings ALTER COLUMN currency_symbol SET DEFAULT 'PKR';
UPDATE public.app_settings SET currency_symbol = 'PKR' WHERE currency_symbol = 'AED';