
-- Replace permissive ALL policies with insert-for-all, update/delete-admin-only

-- categories
DROP POLICY IF EXISTS "Auth manage categories" ON public.categories;
CREATE POLICY "Auth insert categories" ON public.categories FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins update categories" ON public.categories FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete categories" ON public.categories FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- products
DROP POLICY IF EXISTS "Auth manage products" ON public.products;
CREATE POLICY "Auth insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins update products" ON public.products FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete products" ON public.products FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- purchases
DROP POLICY IF EXISTS "Auth manage purchases" ON public.purchases;
CREATE POLICY "Auth insert purchases" ON public.purchases FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins update purchases" ON public.purchases FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete purchases" ON public.purchases FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- purchase_items
DROP POLICY IF EXISTS "Auth manage purchase_items" ON public.purchase_items;
CREATE POLICY "Auth insert purchase_items" ON public.purchase_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins update purchase_items" ON public.purchase_items FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete purchase_items" ON public.purchase_items FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- sales
DROP POLICY IF EXISTS "Auth manage sales" ON public.sales;
CREATE POLICY "Auth insert sales" ON public.sales FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins update sales" ON public.sales FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete sales" ON public.sales FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- sale_items
DROP POLICY IF EXISTS "Auth manage sale_items" ON public.sale_items;
CREATE POLICY "Auth insert sale_items" ON public.sale_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins update sale_items" ON public.sale_items FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete sale_items" ON public.sale_items FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- restaurants
DROP POLICY IF EXISTS "Auth manage restaurants" ON public.restaurants;
CREATE POLICY "Auth insert restaurants" ON public.restaurants FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins update restaurants" ON public.restaurants FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete restaurants" ON public.restaurants FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- suppliers
DROP POLICY IF EXISTS "Auth manage suppliers" ON public.suppliers;
CREATE POLICY "Auth insert suppliers" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins update suppliers" ON public.suppliers FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete suppliers" ON public.suppliers FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- expenses (admin-only module)
DROP POLICY IF EXISTS "Authenticated manage expenses" ON public.expenses;
CREATE POLICY "Admins manage expenses" ON public.expenses FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Authenticated manage expense_categories" ON public.expense_categories;
CREATE POLICY "Admins manage expense_categories" ON public.expense_categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Authenticated manage employees" ON public.employees;
CREATE POLICY "Admins manage employees" ON public.employees FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- payments / supplier payments: staff may not modify
DROP POLICY IF EXISTS "Authenticated can update payments" ON public.payments;
CREATE POLICY "Admins can update payments" ON public.payments FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "Authenticated can update supplier payments" ON public.supplier_payments;
CREATE POLICY "Admins can update supplier payments" ON public.supplier_payments FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
