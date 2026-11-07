const {openLocalDatabase,bootstrap:bootstrapLocal,status:localStatus,listPosData,createLocalPosSale,getLocalReceipt,pendingPos,markPosSynced,markPosFailed,getDevice,setCloudDeviceId,syncCenter,syncSummary,retrySync,listPurchaseData,createLocalPurchase,listLocalPurchases,pendingPurchases,markPurchaseSynced,markPurchaseFailed,listNormalSaleData,createLocalNormalSale,listLocalNormalSales,pendingNormalSales,markNormalSaleSynced,markNormalSaleFailed,paymentData,createLocalRestaurantPayment,createLocalSupplierPayment,listLocalRestaurantPayments,pendingPayments,markPaymentSynced,markPaymentFailed,expenseVaultData,createLocalExpense,createLocalVaultTopup,createLocalCashMovement,listLocalExpenses,listLocalVaultOps,pendingExpenseVault,markExpenseVaultSynced,markExpenseVaultFailed,returnData,createLocalReturn,pendingReturns,markReturnSynced,markReturnFailed,reconciliation,cacheAuthRole,getCachedAuthRole,clearCachedAuthRole}=require("./local-db.cjs");
const {app,BrowserWindow,ipcMain,shell}=require("electron");const path=require("path");const fs=require("fs");const {spawn}=require("child_process");
const isDev=!app.isPackaged;let localServer=null;const LOCAL_PORT=32145;
function startBundledServer() {
  if (isDev) return Promise.resolve();
  const entry = path.join(process.resourcesPath, "app.asar.unpacked", ".output", "server", "index.mjs");
  const logPath = path.join(app.getPath("userData"), "desktop-server.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = (message) => fs.appendFileSync(logPath, new Date().toISOString() + " " + message + "\\n");
  log("Starting server: " + entry + " exists=" + fs.existsSync(entry));
  if (!fs.existsSync(entry)) throw new Error("Bundled application server is missing: " + entry);
  const output = fs.openSync(logPath, "a");
  localServer = spawn(process.execPath, [entry], {
    cwd: path.dirname(entry),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", PORT: String(LOCAL_PORT), HOST: "127.0.0.1" },
    stdio: ["ignore", output, output],
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    let finished = false;
    const fail = (reason) => {
      if (finished) return;
      finished = true;
      log("FAILED: " + reason);
      reject(new Error(reason + ". Check desktop-server.log in the FH Traders app data folder."));
    };
    localServer.on("error", (error) => fail("Server process failed: " + error.message));
    localServer.on("exit", (code, signal) => fail("Server process exited: code=" + code + " signal=" + signal));
    const started = Date.now();
    const check = () => {
      if (finished) return;
      const req = require("http").get(`http://127.0.0.1:${LOCAL_PORT}`, (response) => {
        response.resume();
        if (finished) return;
        finished = true;
        log("READY status=" + response.statusCode);
        resolve();
      });
      req.setTimeout(1000, () => req.destroy());
      req.on("error", () => {
        if (Date.now() - started > 30000) fail("Local application server did not start within 30 seconds");
        else setTimeout(check, 200);
      });
    };
    check();
  });
}
function state(){const dir=app.getPath("userData");fs.mkdirSync(dir,{recursive:true});return {platform:process.platform,version:app.getVersion(),dataDirectory:dir,isPackaged:app.isPackaged};}
function createWindow(){const win=new BrowserWindow({width:1440,height:900,minWidth:1100,minHeight:700,show:false,backgroundColor:"#ffffff",webPreferences:{preload:path.join(__dirname,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true}});
win.once("ready-to-show",()=>win.show());win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url)){shell.openExternal(url);return {action:"deny"}}return {action:"allow"}});
if(isDev){win.loadURL(process.env.FH_DESKTOP_DEV_URL||"http://localhost:5173");}else{win.loadURL(`http://127.0.0.1:${LOCAL_PORT}`);}}
app.whenReady().then(async()=>{await startBundledServer();const localDb=openLocalDatabase(app.getPath("userData"));ipcMain.handle("auth:cache-role",(_e,p)=>cacheAuthRole(localDb,p.userId,p.role,p.email));ipcMain.handle("auth:get-cached-role",(_e,userId)=>getCachedAuthRole(localDb,userId));ipcMain.handle("auth:clear-cached-role",(_e,userId)=>clearCachedAuthRole(localDb,userId));ipcMain.handle("desktop:get-state",()=>state());ipcMain.handle("desktop:get-storage-path",()=>app.getPath("userData"));ipcMain.handle("local-db:status",()=>localStatus(localDb));ipcMain.handle("local-db:bootstrap",(_event,payload)=>({imported:bootstrapLocal(localDb,payload),...localStatus(localDb)}));ipcMain.handle("desktop:device",()=>getDevice(localDb,require("os").hostname()));ipcMain.handle("desktop:set-cloud-device",(_e,{key,id})=>setCloudDeviceId(localDb,key,id));ipcMain.handle("pos:local-data",()=>listPosData(localDb));ipcMain.handle("pos:create-local",(_e,payload)=>createLocalPosSale(localDb,payload));ipcMain.handle("pos:receipt",(_e,id)=>getLocalReceipt(localDb,id));ipcMain.handle("sync:center",()=>syncCenter(localDb));ipcMain.handle("sync:summary",()=>syncSummary(localDb));ipcMain.handle("sync:retry",(_e,id)=>retrySync(localDb,id));ipcMain.handle("purchase:local-data",()=>listPurchaseData(localDb));ipcMain.handle("purchase:create-local",(_e,payload)=>createLocalPurchase(localDb,payload));ipcMain.handle("purchase:list-local",()=>listLocalPurchases(localDb));ipcMain.handle("purchase:pending",()=>pendingPurchases(localDb));ipcMain.handle("purchase:mark-synced",(_e,{operationId,cloud})=>markPurchaseSynced(localDb,operationId,cloud));ipcMain.handle("purchase:mark-failed",(_e,{operationId,error})=>markPurchaseFailed(localDb,operationId,error));ipcMain.handle("sale:local-data",()=>listNormalSaleData(localDb));ipcMain.handle("sale:create-local",(_e,payload)=>createLocalNormalSale(localDb,payload));ipcMain.handle("sale:list-local",()=>listLocalNormalSales(localDb));ipcMain.handle("sale:pending",()=>pendingNormalSales(localDb));ipcMain.handle("sale:mark-synced",(_e,{operationId,cloud})=>markNormalSaleSynced(localDb,operationId,cloud));ipcMain.handle("sale:mark-failed",(_e,{operationId,error})=>markNormalSaleFailed(localDb,operationId,error));ipcMain.handle("return:data",(_e,{kind,invoiceId})=>returnData(localDb,kind,invoiceId));ipcMain.handle("return:create-local",(_e,p)=>createLocalReturn(localDb,p));ipcMain.handle("return:pending",()=>pendingReturns(localDb));ipcMain.handle("return:mark-synced",(_e,{operationId,cloud})=>markReturnSynced(localDb,operationId,cloud));ipcMain.handle("return:mark-failed",(_e,{operationId,error})=>markReturnFailed(localDb,operationId,error));ipcMain.handle("sync:reconciliation",()=>reconciliation(localDb));ipcMain.handle("expense-vault:data",()=>expenseVaultData(localDb));ipcMain.handle("expense:create-local",(_e,p)=>createLocalExpense(localDb,p));ipcMain.handle("vault:create-topup",(_e,p)=>createLocalVaultTopup(localDb,p));ipcMain.handle("vault:create-movement",(_e,p)=>createLocalCashMovement(localDb,p));ipcMain.handle("expense:list-local",()=>listLocalExpenses(localDb));ipcMain.handle("vault:list-local-ops",()=>listLocalVaultOps(localDb));ipcMain.handle("expense-vault:pending",()=>pendingExpenseVault(localDb));ipcMain.handle("expense-vault:mark-synced",(_e,{operationId,cloud,type})=>markExpenseVaultSynced(localDb,operationId,cloud,type));ipcMain.handle("expense-vault:mark-failed",(_e,{operationId,error,type})=>markExpenseVaultFailed(localDb,operationId,error,type));ipcMain.handle("payment:local-data",()=>paymentData(localDb));ipcMain.handle("payment:create-restaurant",(_e,p)=>createLocalRestaurantPayment(localDb,p));ipcMain.handle("payment:create-supplier",(_e,p)=>createLocalSupplierPayment(localDb,p));ipcMain.handle("payment:list-restaurant",()=>listLocalRestaurantPayments(localDb));ipcMain.handle("payment:pending",(_e,type)=>pendingPayments(localDb,type));ipcMain.handle("payment:mark-synced",(_e,{operationId,cloud,type})=>markPaymentSynced(localDb,operationId,cloud,type));ipcMain.handle("payment:mark-failed",(_e,{operationId,error,type})=>markPaymentFailed(localDb,operationId,error,type));ipcMain.handle("pos:pending",()=>pendingPos(localDb));ipcMain.handle("pos:mark-synced",(_e,{operationId,cloud})=>markPosSynced(localDb,operationId,cloud));ipcMain.handle("pos:mark-failed",(_e,{operationId,error})=>markPosFailed(localDb,operationId,error));createWindow();app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})});
app.on("before-quit",()=>{if(localServer) localServer.kill()});app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit()});