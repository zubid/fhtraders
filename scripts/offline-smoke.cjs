const os=require("os"),fs=require("fs"),path=require("path");
const {openLocalDatabase,status,cacheAuthRole,getCachedAuthRole,reconciliation,markPosSynced,markPosFailed,retrySync,pendingPos}=require("../electron/local-db.cjs");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"fh-offline-smoke-"));
function assert(condition,message){if(!condition)throw new Error(message)}
try{
 const db=openLocalDatabase(dir);
 const s=status(db);
 assert(Number(s.schemaVersion)>=8,"Unexpected schema version");
 cacheAuthRole(db,"smoke-user","admin","smoke@example.test");
 assert(getCachedAuthRole(db,"smoke-user")?.role==="admin","Offline role cache failed");
 const r=reconciliation(db);
 assert(r.healthy,"Fresh local reconciliation is not healthy: "+JSON.stringify(r));
 // Simulate a durable queued sale, a network failure, retry, cloud acknowledgement,
 // duplicate acknowledgement after a lost response, and a late failure callback.
 const op="11111111-1111-4111-8111-111111111111";
 const sale="22222222-2222-4222-8222-222222222222";
 const cloud="33333333-3333-4333-8333-333333333333";
 db.prepare("INSERT INTO sync_outbox(id,entity_type,entity_id,operation_type,payload) VALUES(?,?,?,?,?)").run(op,"sales",sale,"insert",JSON.stringify({local_sale_id:sale,items:[]}));
 assert(pendingPos(db).some(x=>x.id===op),"Queued POS operation not replayable");
 markPosFailed(db,op,"Simulated network timeout");
 assert(db.prepare("SELECT status FROM sync_outbox WHERE id=?").get(op).status==="failed","Network timeout must retain failed operation");
 assert(retrySync(db,op)===true,"Failed operation should be retryable");
 assert(db.prepare("SELECT status FROM sync_outbox WHERE id=?").get(op).status==="pending","Retry must requeue operation");
 let invalidAck=false;
 try{markPosSynced(db,op,{id:"not-a-uuid"})}catch{invalidAck=true}
 assert(invalidAck,"Malformed cloud acknowledgement must be rejected");
 assert(db.prepare("SELECT status FROM sync_outbox WHERE id=?").get(op).status==="pending","Invalid acknowledgement must not mark synced");
 markPosSynced(db,op,{id:cloud,invoice_no:"TEST-1"});
 markPosSynced(db,op,{id:cloud,invoice_no:"TEST-1",duplicate:true});
 assert(db.prepare("SELECT status FROM sync_outbox WHERE id=?").get(op).status==="synced","Valid replay acknowledgement must be synced");
 markPosFailed(db,op,"Late timeout callback");
 assert(db.prepare("SELECT status FROM sync_outbox WHERE id=?").get(op).status==="synced","Late failure must not downgrade synced operation");
 assert(retrySync(db,op)===false,"Synced operation must not be retried");
 assert(!pendingPos(db).some(x=>x.id===op),"Synced operation must not be replayed");
 console.log("Offline SQLite smoke test passed",JSON.stringify({schema:s.schemaVersion,reconciliation:r,replay:"passed",lateFailure:"ignored",invalidAck:"rejected"}));
}finally{try{fs.rmSync(dir,{recursive:true,force:true})}catch{}}
