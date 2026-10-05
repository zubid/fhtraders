import { syncPendingPosSales,isDesktop } from "@/lib/desktop-pos";
export type SyncSummary={pending:number;failed:number;synced:number;total:number};
export async function getSyncSummary():Promise<SyncSummary|null>{return isDesktop()?window.fhDesktop!.getSyncSummary():null}
export async function getSyncRows(){return isDesktop()?window.fhDesktop!.getSyncCenter():[]}
export async function retrySyncOperation(id:string){if(!isDesktop())return;await window.fhDesktop!.retrySync(id);await syncPendingPosSales()}
export async function retryAllSync(){if(!isDesktop())return;const rows=await window.fhDesktop!.getSyncCenter();for(const row of rows.filter((r:any)=>r.status==="failed"))await window.fhDesktop!.retrySync(row.id);await syncPendingPosSales()}