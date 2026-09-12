'use strict';
// Electron requires both permission handlers. Never authorize by file: origin
// alone: every local HTML document shares it. Bind to the exact window and URL.
function allowVoicePermission({webContents,trustedWebContents,trustedUrl,active,permission,details,kind}){
 if(!webContents||webContents!==trustedWebContents||webContents.isDestroyed?.()||permission!=='media'||active?.phase!=='recording'||!trustedUrl||details?.isMainFrame!==true||details.requestingUrl!==trustedUrl)return false;
 if(webContents.getURL?.()!==trustedUrl||webContents.mainFrame?.url!==trustedUrl)return false;
 return kind==='check'?details.mediaType==='audio':kind==='request'&&Array.isArray(details.mediaTypes)&&details.mediaTypes.length===1&&details.mediaTypes[0]==='audio';
}
module.exports={allowVoicePermission};
