import { supabase } from "@/integrations/supabase/client";
export type BootstrapResult={skipped:boolean;reason?:string;imported?:number;counts?:Record<string,number>};
async function fetchAll(table:string){const {data,error}=await supabase.from(table as any).select("*");if(error)throw error;return data??[]}
export async function bootstrapDesktopReferenceData():Promise<BootstrapResult>{
 if(typeof window==="undefined"||!window.fhDesktop?.isDesktop)return {skipped:true,reason:"Not running in desktop mode"};
 const [categories,products,restaurants,suppliers,vaultUsers,expense_categories,employees,salesResult,purchasesResult]=await Promise.all([
  fetchAll("categories"),fetchAll("products"),fetchAll("restaurants"),fetchAll("suppliers"),fetchAll("vault_users"),fetchAll("expense_categories"),
  supabase.from("employees").select("id,name,monthly_salary,is_active").eq("is_active",true).then(({data,error})=>{if(error)throw error;return data??[]}),
  supabase.from("sales").select("id,restaurant_id,invoice_no,sale_date,grand_total,amount_received,source,is_voided,sale_items(id,product_id,quantity,unit_price,line_total,cost_price,products(name,unit))").not("restaurant_id","is",null).eq("source","manual"),
  supabase.from("purchases").select("id,supplier_id,reference_no,purchase_date,grand_total,amount_paid,purchase_items(id,product_id,quantity,unit_price,line_total,products(name,unit))").not("supplier_id","is",null)
 ]);
 if((salesResult as any).error)throw (salesResult as any).error;if((purchasesResult as any).error)throw (purchasesResult as any).error;
 const vault_balances=await Promise.all((vaultUsers as any[]).map(async(v:any)=>{const {data,error}=await (supabase.rpc as any)("vault_available_balance",{p_vault_user_id:v.id});if(error)throw error;return {id:v.id,balance:Number(data??0)}}));
 const {data:adjustments,error:adjustmentError}=await supabase.from("inventory_adjustments").select("adjustment_type,sale_id,purchase_id,product_id,quantity");if(adjustmentError)throw adjustmentError;
 const result=await window.fhDesktop.bootstrapLocalData({categories,products,restaurants,suppliers,vault_users:vaultUsers,expense_categories,employees,vault_balances,inventory_adjustments:adjustments??[],cloud_sales:(salesResult as any).data??[],cloud_purchases:(purchasesResult as any).data??[]} as any);
 return {skipped:false,imported:result.imported,counts:result.counts}
}
export async function getDesktopLocalStatus(){if(typeof window==="undefined"||!window.fhDesktop?.isDesktop)return null;return window.fhDesktop.getLocalDbStatus()}