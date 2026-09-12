'use strict';
// The native host reports time awaiting a human, including an ongoing wait.
// Each operation discounts only waits that occurred after it began. Network
// transports retain their own ordinary deadlines between local tool calls.
function createActiveClock(userWait){
 if(userWait!==undefined&&(!userWait||!['subscribe','elapsedMs','isWaiting'].every(key=>typeof userWait[key]==='function')))throw TypeError('Invalid human wait clock.');
 const started=Date.now(),baseline=userWait?.elapsedMs()??0;
 const elapsedMs=()=>Math.max(0,Date.now()-started-Math.max(0,(userWait?.elapsedMs()??0)-baseline));
 function timeout(callback,delay){
  const deadline=elapsedMs()+delay;let timer,closed=false,unsubscribe=()=>{};
  const cancel=()=>{if(closed)return;closed=true;clearTimeout(timer);unsubscribe()};
  const arm=()=>{
   clearTimeout(timer);if(closed||userWait?.isWaiting())return;
   timer=setTimeout(()=>{if(userWait?.isWaiting()||elapsedMs()<deadline){arm();return}cancel();callback()},Math.max(1,deadline-elapsedMs()));
  };
  unsubscribe=userWait?.subscribe(arm)??(()=>{});arm();return cancel;
 }
 return {elapsedMs,timeout};
}
module.exports={createActiveClock};
