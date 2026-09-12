'use strict';
// Write-only: the renderer cannot inspect clipboard contents or request wider
// browser clipboard permissions. IPC caller trust is enforced by main.handle.
function createClipboardService(clipboard){
 return {writeText(text){
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>4*1024*1024||text.includes('\0')||Buffer.from(text,'utf8').toString('utf8')!==text)throw Error('Clipboard text is invalid or exceeds 4 MB.');
  clipboard.writeText(text);
  return null;
 }};
}
module.exports={createClipboardService};
