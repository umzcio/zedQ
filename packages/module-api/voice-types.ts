import type {Result} from './desktop'
export type VoiceSettings={mode:'local'|'provider';engine:'apple-speech';connectionId:string|null;model:string;deviceId:string;language:string}
export type VoiceAvailability={local:{available:boolean;engine:string;languages:string[];message:string};connections:{id:string;name:string}[];models:string[];warning:string|null}
export type VoiceRecording={id:string;originId:string;settings:VoiceSettings}
export type VoiceTranscript={id:string;originId:string;text:string}
export type VoiceBridge={
 load:()=>Promise<Result<VoiceSettings>>;
 save:(settings:VoiceSettings)=>Promise<Result<VoiceSettings>>;
 availability:(language?:string)=>Promise<Result<VoiceAvailability>>;
 begin:(input:{originId:string})=>Promise<Result<VoiceRecording>>;
 transcribe:(input:{id:string;audio:ArrayBuffer})=>Promise<Result<VoiceTranscript>>;
 cancel:(id:string)=>Promise<Result<null>>;
}
