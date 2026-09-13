import type {Connector,ConnectorCatalogEntry,ConnectorInput} from '@zq/module-api'

/** Identity never depends on an editable display name. Preserve path and query case. */
export function normalizeConnectorUrl(value:string){try{const url=new URL(value);url.hash='';url.pathname=url.pathname.replace(/\/+$/,'')||'/';return url.href}catch{return value.trim()}}
export function matchesCatalog(connector:Connector,entry:ConnectorCatalogEntry){return normalizeConnectorUrl(connector.url)===normalizeConnectorUrl(entry.url)&&(!entry.bundled||connector.catalogId===entry.id)}
export function catalogConnector(connectors:Connector[],entry:ConnectorCatalogEntry){return connectors.find(connector=>matchesCatalog(connector,entry)&&connector.status==='connected')??connectors.find(connector=>matchesCatalog(connector,entry))}
export function connectorNeedsSetup(connector:Pick<Connector,'authType'|'clientId'|'hasToken'|'hasClientSecret'|'redirectPort'>,entry?:ConnectorCatalogEntry){if(!entry?.requiresSetup)return false;if(['gmail','google-calendar','google-drive'].includes(entry.id))return (connector.authType??entry.authType)!=='oauth'||!connector.clientId||!connector.hasClientSecret||!Number.isInteger(connector.redirectPort)||connector.redirectPort!<1||connector.redirectPort!>65535;if((connector.authType??entry.authType)==='bearer')return !connector.hasToken;return !connector.clientId}

export function canonicalConnectorUrl(value:string){try{return new URL(value).href}catch{return value.trim()}}
export function catalogCallbackPath(entry:ConnectorCatalogEntry|undefined,input:ConnectorInput){return entry?.redirectPath&&input.catalogId===entry.id&&(input.authType??'oauth')==='oauth'&&!input.clientMetadataUrl?.trim()&&canonicalConnectorUrl(input.url)===entry.url&&input.clientId?.trim()===entry.clientId&&input.redirectPort===entry.redirectPort&&input.redirectHost===entry.redirectHost?entry.redirectPath:'/oauth/callback'}
