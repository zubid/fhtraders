import { syncPendingPosSales,isDesktop } from "@/lib/desktop-pos";
import { syncPendingPurchases } from "@/lib/desktop-purchases";
import { syncPendingNormalSales } from "@/lib/desktop-sales";
import { syncPendingPayments } from "@/lib/desktop-payments";
export type SyncSummary={pending:number;failed:number;synced:number;total:number};
export async function getSyncSummary():Promise<SyncSummary|null>{return isDesktop()?window.fhDesktop!.getSyncSummary():null}
export async function getSyncRows(){return isDesktop()?window.fhDesktop!.getSyncCenter():[]}
export async function retrySyncOperation(id:string){if(!isDesktop())return;await window.fhDesktop!.retrySync(id);await Promise.all([syncPendingPosSales(),syncPendingPurchases(),syncPendingNormalSales(), syncPendingPayments()])}
export async function retryAllSync(){if(!isDesktop())return;const rows=await window.fhDesktop!.getSyncCenter();for(const row of rows.filter((r:any)=>r.status==="failed"))await window.fhDesktop!.retrySync(row.id);await Promise.all([syncPendingPosSales(),syncPendingPurchases(),syncPendingNormalSales(), syncPendingPayments()])}