CREATE OR REPLACE FUNCTION public.on_purchase_item_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE cur_stock NUMERIC; cur_avg NUMERIC; new_bal NUMERIC; new_avg NUMERIC;
BEGIN
  SELECT current_stock, avg_cost INTO cur_stock, cur_avg FROM public.products WHERE id = NEW.product_id FOR UPDATE;
  new_bal := cur_stock + NEW.quantity;
  IF cur_stock > 0 AND new_bal > 0 THEN
    new_avg := ((cur_stock * cur_avg) + (NEW.quantity * NEW.unit_price)) / new_bal;
  ELSE
    -- no (or negative) prior stock: latest purchase price becomes the cost
    new_avg := NEW.unit_price;
  END IF;
  UPDATE public.products SET current_stock = new_bal, avg_cost = new_avg WHERE id = NEW.product_id;
  INSERT INTO public.stock_movements (product_id, movement_type, quantity, balance_after, reference_type, reference_id)
  VALUES (NEW.product_id, 'in', NEW.quantity, new_bal, 'purchase', NEW.purchase_id);
  RETURN NEW;
END; $function$;

UPDATE public.products p
SET avg_cost = lp.unit_price, updated_at = now()
FROM (
  SELECT DISTINCT ON (pi.product_id) pi.product_id, pi.unit_price
  FROM public.purchase_items pi
  JOIN public.purchases pu ON pu.id = pi.purchase_id
  WHERE pi.unit_price > 0
  ORDER BY pi.product_id, pu.purchase_date DESC, pi.created_at DESC
) lp
WHERE p.id = lp.product_id AND p.avg_cost <= 0;