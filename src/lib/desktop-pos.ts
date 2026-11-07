import { supabase } from "@/integrations/supabase/client";
export const isDesktop=()=>typeof window!=="undefined"&&!!window.fhDesktop?.isDesktop;
export async function getDesktopPosData(){if(!isDesktop())return null;return window.fhDesktop!.getLocalPosData()}
export async function createDesktopPosSale(input:any){if(!isDesktop())throw new Error("Desktop POS unavailable");const payload={...input,id:crypto.randomUUID(),operation_id:crypto.randomUUID()};const receipt=await window.fhDesktop!.createLocalPosSale(payload);void syncPendingPosSales();return receipt}
async function ensureCloudDevice(){const d=await window.fhDesktop!.getDevice();if(d.cloud_device_id)return d.cloud_device_id;const {data,error}=await (supabase.rpc as any)("register_sync_device",{p_device_key:d.device_key,p_name:d.name||"FH Traders Desktop",p_location_label:null});if(error)throw error;await window.fhDesktop!.setCloudDevice(d.device_key,data);return data}
export async function syncPendingPosSales(){
 if(!isDesktop()||!navigator.onLine)return;
 const pending=await window.fhDesktop!.getPendingPosSync();
 if(!pending.length)return;
 const deviceId=await ensureCloudDevice();
 for(const row of pending){
  try{
   const p=row.payload;
   // SQLite CURRENT_TIMESTAMP is UTC without a timezone suffix.
   // Use the immutable local outbox timestamp, not the time of reconnection.
   const raw=String(row.created_at??"");
   const iso=/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$/.test(raw)
    ?raw.replace(" ","T")+"Z":raw;
   const occurred=new Date(iso);
   if(!raw||Number.isNaN(occurred.getTime()))
    throw new Error("Offline sale creation time is missing; manual reconciliation required");
   const {data,error}=await (supabase.rpc as any)("sync_pos_sale",{
    p_operation_id:row.id,p_device_id:deviceId,p_local_sale_id:p.local_sale_id,
    p_items:p.items.map((x:any)=>({product_id:x.product_id,quantity:x.quantity,unit_price:x.unit_price})),
    p_customer_name:p.customer_name??"",p_discount:p.discount??0,
    p_method:p.payment_method,p_vault_user_id:p.vault_user_id||null,p_note:null,
    p_occurred_at:occurred.toISOString(),
   });
   if(error)throw error;
   await window.fhDesktop!.markPosSynced(row.id,data);
  }catch(e:any){
   // Keep failed transactions in local outbox for manual reconciliation.
   // Never rewrite the original sale date or automatically move it to today.
   await window.fhDesktop!.markPosFailed(row.id,e?.message??String(e));
  }
 }
}
export async function getDesktopReceipt(id:string){return isDesktop()?window.fhDesktop!.getLocalPosReceipt(id):null}