import type { Result } from './desktop'
export type ConnectorTool = {name:string;title?:string;description:string;inputSchema:Record<string,unknown>;enabled:boolean;readOnly:boolean}
export type ConnectorAuthType='oauth'|'bearer'
export type Connector = {id:string;name:string;url:string;status:'disconnected'|'connecting'|'authenticating'|'connected'|'error';error?:string;revision:number;clientId?:string;clientMetadataUrl?:string;catalogId?:string;authType?:ConnectorAuthType;hasToken?:boolean;hasClientSecret?:boolean;redirectPort?:number;redirectHost?:'127.0.0.1'|'localhost';tools:ConnectorTool[]}
export type ConnectorInput = {id?:string;name:string;url:string;clientId?:string;clientMetadataUrl?:string;catalogId?:string;authType?:ConnectorAuthType;token?:string;clientSecret?:string;redirectPort?:number;redirectHost?:'127.0.0.1'|'localhost'}
export type ConnectorCatalogEntry={id:string;name:string;description:string;category:'Research'|'Productivity'|'Development';url:string;publisher:string;documentationUrl:string;accountLabel:string;setupNote:string;authType:ConnectorAuthType;clientId?:string;redirectPort?:number;redirectHost?:'127.0.0.1'|'localhost';redirectPath?:'/'|'/oauth/callback';requiresSetup:boolean;bundled?:boolean}
export type ConnectorBridge = {
 catalog:()=>Promise<Result<ConnectorCatalogEntry[]>>;
 list:()=>Promise<Result<Connector[]>>;
 save:(input:ConnectorInput)=>Promise<Result<Connector[]>>;
 connect:(id:string)=>Promise<Result<Connector[]>>;
 disconnect:(id:string)=>Promise<Result<Connector[]>>;
 remove:(id:string)=>Promise<Result<Connector[]>>;
 setTools:(input:{id:string;names:string[]})=>Promise<Result<Connector[]>>;
 subscribe:(callback:(connectors:Connector[])=>void)=>()=>void;
}
