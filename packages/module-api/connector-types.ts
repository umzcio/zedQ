import type { Result } from './desktop'
export type ConnectorTool = {name:string;title?:string;description:string;inputSchema:Record<string,unknown>;enabled:boolean;readOnly:boolean}
export type Connector = {id:string;name:string;url:string;status:'disconnected'|'connecting'|'authenticating'|'connected'|'error';error?:string;revision:number;clientId?:string;clientMetadataUrl?:string;tools:ConnectorTool[]}
export type ConnectorInput = {id?:string;name:string;url:string;clientId?:string;clientMetadataUrl?:string}
export type ConnectorBridge = {
 list:()=>Promise<Result<Connector[]>>;
 save:(input:ConnectorInput)=>Promise<Result<Connector[]>>;
 connect:(id:string)=>Promise<Result<Connector[]>>;
 disconnect:(id:string)=>Promise<Result<Connector[]>>;
 remove:(id:string)=>Promise<Result<Connector[]>>;
 setTools:(input:{id:string;names:string[]})=>Promise<Result<Connector[]>>;
 subscribe:(callback:(connectors:Connector[])=>void)=>()=>void;
}
