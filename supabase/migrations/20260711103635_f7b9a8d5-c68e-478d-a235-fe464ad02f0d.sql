
-- ========== ROLES ==========
CREATE TYPE public.app_role AS ENUM ('admin', 'staff');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins read all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- new user -> profile + default staff role; first user becomes admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count INT;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.email);

  SELECT count(*) INTO user_count FROM auth.users;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'staff');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ========== CATEGORIES ==========
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  default_unit TEXT NOT NULL DEFAULT 'pcs',
  color TEXT NOT NULL DEFAULT '#6366f1',
  icon TEXT NOT NULL DEFAULT 'package',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read categories" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage categories" ON public.categories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_categories_updated BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== SUPPLIERS ==========
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read suppliers" ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage suppliers" ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== PRODUCTS ==========
CREATE SEQUENCE public.sku_seq START 1000;
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  sku TEXT NOT NULL UNIQUE DEFAULT ('SKU-' || nextval('public.sku_seq')),
  reorder_level NUMERIC NOT NULL DEFAULT 0,
  max_stock_level NUMERIC NOT NULL DEFAULT 0,
  current_stock NUMERIC NOT NULL DEFAULT 0,
  avg_cost NUMERIC NOT NULL DEFAULT 0,
  default_purchase_price NUMERIC NOT NULL DEFAULT 0,
  default_selling_price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_category ON public.products(category_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage products" ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== RESTAURANTS ==========
CREATE TABLE public.restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  address TEXT,
  email TEXT,
  credit_terms TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurants TO authenticated;
GRANT ALL ON public.restaurants TO service_role;
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read restaurants" ON public.restaurants FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage restaurants" ON public.restaurants FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_restaurants_updated BEFORE UPDATE ON public.restaurants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== PURCHASES ==========
CREATE SEQUENCE public.purchase_seq START 1000;
CREATE TABLE public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no TEXT NOT NULL UNIQUE DEFAULT ('PUR-' || nextval('public.purchase_seq')),
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  grand_total NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_purchases_date ON public.purchases(purchase_date);
CREATE INDEX idx_purchases_supplier ON public.purchases(supplier_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read purchases" ON public.purchases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage purchases" ON public.purchases FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL,
  unit_price NUMERIC NOT NULL,
  line_total NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_purchase_items_purchase ON public.purchase_items(purchase_id);
CREATE INDEX idx_purchase_items_product ON public.purchase_items(product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_items TO authenticated;
GRANT ALL ON public.purchase_items TO service_role;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read purchase_items" ON public.purchase_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage purchase_items" ON public.purchase_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ========== SALES ==========
CREATE SEQUENCE public.sale_seq START 1000;
CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT NOT NULL UNIQUE DEFAULT ('INV-' || nextval('public.sale_seq')),
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE SET NULL,
  sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC NOT NULL DEFAULT 0,
  tax NUMERIC NOT NULL DEFAULT 0,
  grand_total NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sales_date ON public.sales(sale_date);
CREATE INDEX idx_sales_restaurant ON public.sales(restaurant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read sales" ON public.sales FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage sales" ON public.sales FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL,
  unit_price NUMERIC NOT NULL,
  cost_price NUMERIC NOT NULL DEFAULT 0,
  line_total NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sale_items_sale ON public.sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON public.sale_items(product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_items TO authenticated;
GRANT ALL ON public.sale_items TO service_role;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read sale_items" ON public.sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage sale_items" ON public.sale_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ========== STOCK MOVEMENTS LEDGER ==========
CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL, -- 'in' | 'out'
  quantity NUMERIC NOT NULL,
  balance_after NUMERIC NOT NULL,
  reference_type TEXT, -- 'purchase' | 'sale'
  reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_movements_product ON public.stock_movements(product_id);
CREATE INDEX idx_movements_date ON public.stock_movements(created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read movements" ON public.stock_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage movements" ON public.stock_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ========== STOCK TRIGGERS ==========
-- Purchase item: increase stock, update weighted-avg cost, log movement
CREATE OR REPLACE FUNCTION public.on_purchase_item_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur_stock NUMERIC; cur_avg NUMERIC; new_bal NUMERIC; new_avg NUMERIC;
BEGIN
  SELECT current_stock, avg_cost INTO cur_stock, cur_avg FROM public.products WHERE id = NEW.product_id FOR UPDATE;
  new_bal := cur_stock + NEW.quantity;
  IF new_bal > 0 THEN
    new_avg := ((cur_stock * cur_avg) + (NEW.quantity * NEW.unit_price)) / new_bal;
  ELSE
    new_avg := cur_avg;
  END IF;
  UPDATE public.products SET current_stock = new_bal, avg_cost = new_avg WHERE id = NEW.product_id;
  INSERT INTO public.stock_movements (product_id, movement_type, quantity, balance_after, reference_type, reference_id)
  VALUES (NEW.product_id, 'in', NEW.quantity, new_bal, 'purchase', NEW.purchase_id);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_purchase_item_insert AFTER INSERT ON public.purchase_items FOR EACH ROW EXECUTE FUNCTION public.on_purchase_item_insert();

CREATE OR REPLACE FUNCTION public.on_purchase_item_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_bal NUMERIC;
BEGIN
  UPDATE public.products SET current_stock = current_stock - OLD.quantity WHERE id = OLD.product_id
  RETURNING current_stock INTO new_bal;
  INSERT INTO public.stock_movements (product_id, movement_type, quantity, balance_after, reference_type, reference_id)
  VALUES (OLD.product_id, 'out', OLD.quantity, new_bal, 'purchase_reversal', OLD.purchase_id);
  RETURN OLD;
END; $$;
CREATE TRIGGER trg_purchase_item_delete AFTER DELETE ON public.purchase_items FOR EACH ROW EXECUTE FUNCTION public.on_purchase_item_delete();

-- Sale item: capture cost, decrease stock, log movement
CREATE OR REPLACE FUNCTION public.on_sale_item_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur_stock NUMERIC; cur_avg NUMERIC; new_bal NUMERIC;
BEGIN
  SELECT current_stock, avg_cost INTO cur_stock, cur_avg FROM public.products WHERE id = NEW.product_id FOR UPDATE;
  new_bal := cur_stock - NEW.quantity;
  IF NEW.cost_price = 0 THEN NEW.cost_price := cur_avg; END IF;
  UPDATE public.products SET current_stock = new_bal WHERE id = NEW.product_id;
  INSERT INTO public.stock_movements (product_id, movement_type, quantity, balance_after, reference_type, reference_id)
  VALUES (NEW.product_id, 'out', NEW.quantity, new_bal, 'sale', NEW.sale_id);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_sale_item_insert BEFORE INSERT ON public.sale_items FOR EACH ROW EXECUTE FUNCTION public.on_sale_item_insert();

CREATE OR REPLACE FUNCTION public.on_sale_item_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_bal NUMERIC;
BEGIN
  UPDATE public.products SET current_stock = current_stock + OLD.quantity WHERE id = OLD.product_id
  RETURNING current_stock INTO new_bal;
  INSERT INTO public.stock_movements (product_id, movement_type, quantity, balance_after, reference_type, reference_id)
  VALUES (OLD.product_id, 'in', OLD.quantity, new_bal, 'sale_reversal', OLD.sale_id);
  RETURN OLD;
END; $$;
CREATE TRIGGER trg_sale_item_delete AFTER DELETE ON public.sale_items FOR EACH ROW EXECUTE FUNCTION public.on_sale_item_delete();
