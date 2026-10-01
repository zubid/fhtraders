import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog,DialogContent,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";

export function ReturnDialog({open,onOpenChange,record,kind}:{open:boolean;onOpenChange:(v:boolean)=>void;record:any;kind:"sale"|"supplier"}){
 const qc=useQueryClient(); const [product,setProduct]=useState(""); const [qty,setQty]=useState(1); const [reason,setReason]=useState(""); const [vault,setVault]=useState(""); const [cashRefund,setCashRefund]=useState(0);
 const embeddedItems=kind==="sale"?record?.sale_items??[]:record?.purchase_items??[];
 const {data:freshItems,isLoading:itemsLoading}=useQuery({queryKey:["return-items",kind,record?.id],enabled:open&&!!record?.id,queryFn:async()=>{const table=kind==="sale"?"sale_items":"purchase_items";const fk=kind==="sale"?"sale_id":"purchase_id";const {data,error}=await (supabase.from(table as any) as any).select("id,product_id,quantity,unit_price,line_total,products(name,unit)").eq(fk,record.id);if(error)throw error;return data??[]}});
 const items=(freshItems?.length?freshItems:embeddedItems) as any[];
 const {data:vaults}=useQuery({queryKey:["return-vaults"],queryFn:async()=>((await (supabase.rpc as any)("list_business_cash_vaults")).data??[]) as any[]});
 const selected=items.find((x:any)=>x.product_id===product);
 const amount=selected?Number(selected.unit_price)*qty:0;
 const save=useMutation({mutationFn:async()=>{if(!product||qty<=0||!reason.trim())throw new Error("Product, quantity and reason are required");
   const args=kind==="sale"?{p_sale_id:record.id,p_product_id:product,p_quantity:qty,p_reason:reason,p_vault_user_id:vault||null}:{p_purchase_id:record.id,p_product_id:product,p_quantity:qty,p_reason:reason,p_vault_user_id:vault||null,p_cash_refund:cashRefund};
   const fn=kind==="sale"?"record_sale_return":"record_supplier_return"; const {error}=await (supabase.rpc as any)(fn,args); if(error)throw error;
 },onSuccess:()=>{toast.success(kind==="sale"?"Sale return recorded":"Supplier return recorded");qc.invalidateQueries();onOpenChange(false);setProduct("");setQty(1);setReason("");setVault("");setCashRefund(0)},onError:(e:Error)=>toast.error(e.message)});
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{kind==="sale"?"Return from Customer":"Return to Supplier"} · {record?.invoice_no??record?.reference_no}</DialogTitle></DialogHeader>
 <div className="space-y-3"><div><Label>Item</Label><Select value={product} onValueChange={(v)=>{setProduct(v);setQty(1)}}><SelectTrigger><SelectValue placeholder={itemsLoading?"Loading items...":items.length?"Select item":"No items found"}/></SelectTrigger><SelectContent>{items.map((i:any)=><SelectItem key={i.product_id} value={i.product_id}>{i.products?.name} · {i.quantity} available</SelectItem>)}</SelectContent></Select></div>
 <div><Label>Return Quantity</Label><Input type="number" min={0.001} max={selected?.quantity} value={qty} onChange={e=>setQty(Number(e.target.value))}/></div>
 <div><Label>Return Value</Label><Input readOnly value={selected?amount.toFixed(2):""} placeholder="Select an item to calculate automatically"/></div>
 {kind==="supplier"&&<div><Label>Cash Refunded by Supplier</Label><Input type="number" min={0} max={amount} value={cashRefund} onChange={e=>setCashRefund(Number(e.target.value))}/></div>}
 <div><Label>{kind==="sale"?"Refund from Vault (required only when paid amount must be refunded)":"Refund received in Vault (required when cash refund > 0)"}</Label><Select value={vault} onValueChange={setVault}><SelectTrigger><SelectValue placeholder="Select if applicable"/></SelectTrigger><SelectContent>{(vaults??[]).map((v:any)=><SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select></div>
 <div><Label>Reason</Label><Input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Required return reason"/></div>
 {!itemsLoading&&!items.length&&<p className="text-sm text-destructive">No invoice items could be loaded. Close this window and refresh the page.</p>}
 <Button className="w-full" onClick={()=>save.mutate()} disabled={save.isPending||itemsLoading||!items.length}>Record Return</Button></div></DialogContent></Dialog>
}