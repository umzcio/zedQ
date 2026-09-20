import type {Result} from './desktop'
import type {GeneratedFileTarget} from './chat-types'
export type ArtifactFontFamily='Arial'|'Times New Roman'|'Georgia'|'Verdana'|'Courier New'|'Bradley Hand'|'Brush Script MT'|'Comic Sans MS'
export type ArtifactTypography={fontFamily?:ArtifactFontFamily;titleFontFamily?:ArtifactFontFamily;headingFontFamily?:ArtifactFontFamily;bodyFontFamily?:ArtifactFontFamily;titleSize?:number;headingSize?:number;bodySize?:number}
export type ArtifactFormat='pdf'|'docx'|'xlsx'|'pptx'
export type ArtifactSource={conversationId?:string;messageId?:string;versionId?:string;conversationTitle?:string;projectId?:string;projectName?:string;generatedFileId?:string}
export type ArtifactVersion={typography?:ArtifactTypography;id:string;number:number;name:string;mime:string;size:number;createdAt:number;source?:ArtifactSource}
export type Artifact={id:string;name:string;format:string;createdAt:number;updatedAt:number;deletedAt:number|null;versions:ArtifactVersion[]}
export type ArtifactTarget={artifactId:string;versionId:string}
export type ArtifactReference=ArtifactTarget&{name:string}
export type ArtifactCreate={typography?:ArtifactTypography;artifactId?:string;expectedLatestVersionId?:string;format:ArtifactFormat;title:string;content:string;source?:ArtifactSource}
export type ArtifactDocumentFile={name:string;mime:string;data:string;format:string}
export type ResearchDataset={id:string;title:string;method:string;columns:{key:string;label:string;type:'text'|'number';unit?:string}[];rows:{values:(string|number|null)[];evidenceIds:string[]}[]}
export type ResearchChart={id:string;title:string;type:'bar'|'line'|'scatter';datasetId:string;x:string;y:string}
export type ResearchReportDocument={schemaVersion:1;jobId:string;title:string;markdown:string;citationIds:string[];evidence:import('./research-types').ResearchEvidence[];findings:import('./research-types').ResearchFinding[];gaps:string[];sources:import('./research-types').ResearchSource[];plan:import('./research-types').ResearchPlan;choice:import('./chat-types').ModelChoice;createdAt:number;datasets:ResearchDataset[];charts:ResearchChart[];previousReport?:ArtifactTarget}
export type ResearchReportView={document:ResearchReportDocument;charts:{id:string;image:string}[];datasets:{id:string;csv:string}[]}
export type ResearchExport=ArtifactTarget&{format:'markdown'|'pdf'|'csv'|'svg';itemId?:string}
export type ArtifactBridge={
 researchView:(input:ArtifactTarget)=>Promise<Result<ResearchReportView>>;
 reviseResearch:(input:ArtifactTarget&{expectedLatestVersionId:string;title:string;markdown:string})=>Promise<Result<Artifact>>;
 exportResearch:(input:ResearchExport)=>Promise<Result<boolean>>;
 document:(input:ArtifactTarget)=>Promise<Result<ArtifactDocumentFile>>;
 status:()=>Promise<Result<{warning:string}>>;
 list:()=>Promise<Result<Artifact[]>>;
 create:(input:ArtifactCreate)=>Promise<Result<Artifact>>;
 importGenerated:(input:GeneratedFileTarget)=>Promise<Result<Artifact>>;
 update:(input:{id:string;name?:string;deleted?:boolean})=>Promise<Result<Artifact>>;
 version:(input:ArtifactTarget)=>Promise<Result<ArtifactVersion&{format:string;artifactName:string;content?:string}>>;
 preview:(input:ArtifactTarget)=>Promise<Result<{text?:string;image?:string}>>;
 save:(input:ArtifactTarget)=>Promise<Result<boolean>>;
 subscribe:(callback:(items:Artifact[])=>void)=>()=>void;
}
