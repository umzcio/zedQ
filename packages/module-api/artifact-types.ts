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
export type ArtifactBridge={
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
