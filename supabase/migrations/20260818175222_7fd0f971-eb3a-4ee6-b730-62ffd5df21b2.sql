UPDATE public.supplier_payments sp
SET vault_user_id = p.vault_user_id
FROM public.purchases p
WHERE p.id = sp.purchase_id
  AND sp.vault_user_id = '7ce7dbf8-39d6-4397-b6fa-9fc0eff43d24'
  AND p.vault_user_id = 'd1c98b52-0391-4227-9d3a-bf7a3cab4568';