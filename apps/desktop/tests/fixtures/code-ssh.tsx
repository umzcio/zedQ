import React from 'react';
import {createRoot} from 'react-dom/client';
import {ModuleHostProvider} from '@zq/module-api';
import Code from '../../../../modules/code';
import '@zq/ui/styles.css';
import '../../src/shell.css';
const state:any={version:1,seq:1,hosts:[{id:'local',name:'This Mac',kind:'local',available:true}],projects:[],profiles:[],sessions:[],runtime:{tmux:true,pty:true,chat:true,claude:true,reason:null}};
const transferRows:any[]=[];
const calls:any[]=[];let listener:any=()=>{};const terminalListeners=new Set<any>();const inventory=new Map<string,any[]>();
const publish=()=>{state.seq++;listener(structuredClone(state))};
const bridge:any={subscribe(fn:any){listener=fn;return()=>{listener=()=>{}}},onTerminal(fn:any){terminalListeners.add(fn);return()=>terminalListeners.delete(fn)},async invoke(method:string,input:any){calls.push([method,input]);
 switch(method){
 case 'snapshot':return structuredClone(state);
 case 'discoverHosts':return {aliases:['test-host','second-host','hidden-host',...Array.from({length:24},(_,i)=>'server-'+String(i+1).padStart(2,'0'))]};
 case 'createHost':{const h={id:crypto.randomUUID(),kind:'ssh',available:false,...input};state.hosts.push(h);publish();return h;}
 case 'updateHost':{const h=state.hosts.find((h:any)=>h.id===input.id);Object.assign(h,input.patch);publish();return h;}
 case 'connectHost':{if((window as any).failConnect)throw Error('SSH_SUDO_REQUIRED');const h=state.hosts.find((h:any)=>h.id===input.id);h.available=true;state.sessions.filter((s:any)=>s.hostId===h.id).forEach((s:any)=>s.state='ready');inventory.set(h.id,[{target:'$1',identity:h.id,name:h.runAs==='root'?'root-work':'login-work',windows:2,cwd:'/srv/work',attached:false}]);publish();return h;}
 case 'disconnectHost':state.hosts.find((h:any)=>h.id===input.id).available=false;publish();return {ok:true};
 case 'discoverTerminals':return inventory.get(input.hostId)||[];
 case 'attachExternalTerminal':case 'createTerminal':{let s=state.sessions.find((s:any)=>s.hostId===input.hostId&&s.tmuxTarget===input.target);if(!s){s={id:crypto.randomUUID(),hostId:input.hostId,projectId:input.projectId||'',title:input.name||inventory.get(input.hostId)?.[0].name,mode:'terminal',adapter:'terminal',ownership:'external',state:'ready',revision:0,cwd:'/srv/work',tmuxTarget:input.target||'$2',profileId:'',nativeId:'',nativeIdVerified:false,createdAt:Date.now(),updatedAt:Date.now(),archivedAt:null,pid:null,error:null};state.sessions.push(s)}publish();return s;}
 case 'attachTerminal':queueMicrotask(()=>{terminalListeners.forEach(fn=>fn({sessionId:input.id,attachmentId:input.attachmentId,data:'fixture shell\r\n$ ',reset:true,...((window as any).exitOnAttach ? {exited:true,exitCode:1} : {})}))});return {ok:true,attachmentId:input.attachmentId};
 case 'createProject':{const p={...input,id:crypto.randomUUID(),createdAt:Date.now()};state.projects.push(p);publish();return p;}
 case 'linkTerminal':{const s=state.sessions.find((s:any)=>s.id===input.id);s.projectId=input.projectId||'';publish();return s;}
 case 'listFiles':return {entries:input.path==='docs'?[{name:'nested.txt',path:'docs/nested.txt',kind:'file',size:5}]:[{name:'docs',path:'docs',kind:'directory',size:0},{name:'readme.txt',path:'readme.txt',kind:'file',size:5},{name:'archive.zip',path:'archive.zip',kind:'file',size:100000}],truncated:false};
 case 'readFile':if(input.path==='archive.zip')throw Error('BINARY_FILE');return {path:input.path,text:'hello',fingerprint:'abc'};
 case 'writeFile':return {...input,fingerprint:'def'};
 case 'fileTransfers':return structuredClone(transferRows);
 case 'uploadFiles':case 'downloadFile':{if((window as any).cancelTransfer)return {completed:0,canceled:true};const row={id:crypto.randomUUID(),name:method==='uploadFiles'?'uploaded.zip':input.path,direction:method==='uploadFiles'?'upload':'download',bytes:0,total:100,state:'running'};transferRows.push(row);await new Promise(r=>setTimeout(r,1000));row.bytes=100;row.state='done';return {completed:1,canceled:false};}
 case 'gitStatus':return {changes:[],truncated:false};
 case 'gitRepository':return {isRepository:false};
 default:return {ok:true};
 }
}};
(window as any).exitTerminal=()=>{const [,input]=calls.filter(c=>c[0]==='attachTerminal').at(-1);terminalListeners.forEach(fn=>fn({sessionId:input.id,attachmentId:input.attachmentId,data:'connection closed\r\n',exited:true,exitCode:1}))};
(window as any).disconnectSSH=()=>{state.hosts.filter((h:any)=>h.kind==='ssh').forEach((h:any)=>h.available=false);state.sessions.forEach((s:any)=>s.state='disconnected');publish()};
(window as any).sshCalls=calls;(window as any).sshState=state;
const sidebar=document.createElement('aside'),view=document.createElement('main');document.body.append(sidebar,view);Object.assign(sidebar.style,{position:'fixed',left:'0',top:'0',bottom:'0',width:'230px',overflow:'auto',paddingTop:'20px'});Object.assign(view.style,{position:'fixed',left:'230px',right:'0',top:'0',bottom:'0'});
const host:any={workspace:{layout:{view:'Code'}},manifest:{id:'zq.code',view:'Code'},targets:{sidebar,view},services:{code:bridge,clipboard:{writeText:async()=>({ok:true})}},commands:{register:()=>()=>{}},navigate(){},notify(){}};
createRoot(document.getElementById('root')!).render(<ModuleHostProvider value={host}><Code.Root/></ModuleHostProvider>);
