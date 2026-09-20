import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
if(process.platform!=='darwin')throw new Error('Build macOS releases on a Mac.')
if(!process.env.CSC_NAME)throw new Error('Set CSC_NAME to your Developer ID Application identity.')
const hasNotarization=['APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID'].every(key=>process.env[key])||['APPLE_API_KEY','APPLE_API_KEY_ID','APPLE_API_ISSUER'].every(key=>process.env[key])||process.env.APPLE_KEYCHAIN_PROFILE
if(!hasNotarization)throw new Error('Configure Apple notarization credentials before building a release.')
const env={...process.env,ZQ_KEYCHAIN_SIGN_IDENTITY:process.env.CSC_NAME,ZQ_VOICE_SIGN_IDENTITY:process.env.CSC_NAME,ZQ_NATIVE_SIGNING_IDENTITY:process.env.CSC_NAME}
function run(args){const result=spawnSync('npm',args,{cwd:root,env,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1)}
run(['run','build'])
run(['exec','-w','@zq/desktop','--','electron-builder','--config','build/release.cjs','--mac','--arm64','--publish','never'])
