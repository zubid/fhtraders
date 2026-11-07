import { supabase } from "@/integrations/supabase/client";
export type BootstrapResult={skipped:boolean;reason?:string;imported?:number;counts?:Record<string,number>};
// Supabase/PostgREST may cap each response at 1,000 rows. Never mark a
// snapshot complete when only the first page was downloaded.
async function fetchAll(table:string){
 const rows:any[]=[];const pageSize=500;
 for(let offset=0;;offset+=pageSize){
  const {data,error}=await supabase.from(table as any).select("*").order("id").range(offset,offset+pageSize-1);
  if(error)throw error;
  rows.push(...(data??[]));
  if(!data||data.length<pageSize)break;
 }
 return rows;
}
async function fetchInvoicePages(table:"sales"|"purchases",columns:string,configure:(query:any)=>any){
 const rows:any[]=[];const pageSize=200;
 for(let offset=0;;offset+=pageSize){
  const query=configure((supabase.from(table) as any).select(columns).order("id").range(offset,offset+pageSize-1));
  const {data,error}=await query;
  if(error)throw error;
  rows.push(...(data??[]));
  if(!data||data.length<pageSize)break;
 }
 return rows;
}
export async function bootstrapDesktopReferenceData():Promise<BootstrapResult>{
 if(typeof window==="undefined"||!window.fhDesktop?.isDesktop)return {skipped:true,reason:"Not running in desktop mode"};
 const [categories,products,restaurants,suppliers,vaultUsers,expense_categories,employees,salesResult,purchasesResult]=await Promise.all([
  fetchAll("categories"),fetchAll("products"),fetchAll("restaurants"),fetchAll("suppliers"),fetchAll("vault_users"),fetchAll("expense_categories"),
  fetchAll("employees"),
  fetchInvoicePages("sales","id,restaurant_id,invoice_no,sale_date,grand_total,amount_received,source,is_voided,sale_items(id,product_id,quantity,unit_price,line_total,cost_price,products(name,unit))",q=>q.not("restaurant_id","is",null).eq("source","manual")),
  fetchInvoicePages("purchases","id,supplier_id,reference_no,purchase_date,grand_total,amount_paid,purchase_items(id,product_id,quantity,unit_price,line_total,products(name,unit))",q=>q.not("supplier_id","is",null))
 ]);

 const vault_balances=await Promise.all((vaultUsers as any[]).map(async(v:any)=>{const {data,error}=await (supabase.rpc as any)("vault_available_balance",{p_vault_user_id:v.id});if(error)throw error;return {id:v.id,balance:Number(data??0)}}));
 const adjustments=await fetchAll("inventory_adjustments");
 const result=await window.fhDesktop.bootstrapLocalData({categories,products,restaurants,suppliers,vault_users:vaultUsers,expense_categories,employees,vault_balances,inventory_adjustments:adjustments,cloud_sales:salesResult,cloud_purchases:purchasesResult} as any);
 return {skipped:false,imported:result.imported,counts:result.counts}
}
export async function getDesktopLocalStatus(){if(typeof window==="undefined"||!window.fhDesktop?.isDesktop)return null;return window.fhDesktop.getLocalDbStatus()}