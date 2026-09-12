import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdir,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
if(process.platform!=='darwin'){console.log('Skipping Apple Speech helper on this platform.');process.exit(0)}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),source=path.join(root,'apps/desktop/native/voice-transcribe.swift'),output=path.join(root,'apps/desktop/native/bin/voice-transcribe'),identity=process.env.ZQ_VOICE_SIGN_IDENTITY||'-'
const architecture=process.env.ZQ_VOICE_ARCH||process.arch
if(!['arm64','x64'].includes(architecture))throw Error('Unsupported Voice helper architecture')
const target=`${architecture==='x64'?'x86_64':'arm64'}-apple-macosx13.0`
function run(command,args){const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:1024*1024});if(result.error||result.status!==0){process.stderr.write(result.stderr||'');throw Error(`Voice helper build failed: ${command}`)}return result.stdout}
const compiler=run('/usr/bin/xcrun',['swiftc','--version']),hash=createHash('sha256').update(await readFile(source)).update(await readFile(fileURLToPath(import.meta.url))).update(compiler).update(target).update(identity).digest('hex')
try{if((await readFile(output+'.build-hash','utf8')).trim()===hash){run('/usr/bin/codesign',['--verify','--strict',output]);console.log('Apple Speech helper is up to date.');process.exit(0)}}catch{}
await mkdir(path.dirname(output),{recursive:true})
const temporary=await mkdtemp(path.join(tmpdir(),'zq-voice-build-'))
try{
 const binary=path.join(temporary,'voice-transcribe'),plist=path.join(temporary,'Info.plist')
 await writeFile(plist,'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.zedq.desktop.voice-transcribe</string><key>CFBundleName</key><string>zQ Voice</string><key>NSSpeechRecognitionUsageDescription</key><string>Transcribe your recording on this Mac when you choose on-device dictation.</string></dict></plist>')
 run('/usr/bin/xcrun',['swiftc',source,'-O','-target',target,'-framework','Speech','-module-cache-path',path.join(temporary,'module-cache'),'-Xlinker','-sectcreate','-Xlinker','__TEXT','-Xlinker','__info_plist','-Xlinker',plist,'-o',binary])
 run('/usr/bin/codesign',['--force','--sign',identity,'--identifier','dev.zedq.desktop.voice-transcribe','--options','runtime',...(identity==='-'?[]:['--timestamp']),binary])
 run('/usr/bin/codesign',['--verify','--strict',binary]);await rename(binary,output);await writeFile(output+'.build-hash',hash+'\n');console.log(`Built Apple Speech helper (${architecture}).`)
}finally{await rm(temporary,{recursive:true,force:true})}
