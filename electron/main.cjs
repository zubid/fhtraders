const {app,BrowserWindow,ipcMain,shell}=require("electron");const path=require("path");const fs=require("fs");
const isDev=!app.isPackaged;
function state(){const dir=app.getPath("userData");fs.mkdirSync(dir,{recursive:true});return {platform:process.platform,version:app.getVersion(),dataDirectory:dir,isPackaged:app.isPackaged};}
function createWindow(){const win=new BrowserWindow({width:1440,height:900,minWidth:1100,minHeight:700,show:false,backgroundColor:"#ffffff",webPreferences:{preload:path.join(__dirname,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true}});
win.once("ready-to-show",()=>win.show());win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url)){shell.openExternal(url);return {action:"deny"}}return {action:"allow"}});
if(isDev){win.loadURL(process.env.FH_DESKTOP_DEV_URL||"http://localhost:5173");}else{const index=path.join(process.resourcesPath,"app","dist","client","index.html");if(fs.existsSync(index))win.loadFile(index);else win.loadURL(process.env.FH_DESKTOP_WEB_URL||"https://fhtraders.lovable.app");}}
app.whenReady().then(()=>{ipcMain.handle("desktop:get-state",()=>state());ipcMain.handle("desktop:get-storage-path",()=>app.getPath("userData"));createWindow();app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit()});