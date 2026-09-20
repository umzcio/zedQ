const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util')
const exec=promisify(execFile)
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const issueFields='number,title,author,state,updatedAt,assignees,labels,stateReason'
const fields='number,title,url,author,isDraft,state,headRefOid,updatedAt,reviewDecision,reviewRequests,statusCheckRollup'
function failure(message,code='GITHUB_UNAVAILABLE'){return Object.assign(Error(message),{code})}
function classifyFailure(e){
 const stderr=String(e.stderr||'')
 if(/repository has disabled issues/i.test(stderr))return failure('Issues are disabled in this repository.','GITHUB_ISSUES_DISABLED')
 if(/auth login|not logged|authentication|HTTP 401/i.test(stderr))return failure('GitHub needs a login. Run gh auth login --hostname github.com in Terminal, then refresh.')
 if(/rate limit|secondary limit|abuse detection|HTTP 429/i.test(stderr)){const error=failure('GitHub is temporarily limiting requests. Sync is paused.','GITHUB_RATE_LIMITED');const retry=stderr.match(/retry[- ]after[:\s]+(\d+)/i);if(retry)error.retryAt=Date.now()+Number(retry[1])*1000;return error}
 return failure('GitHub could not be read. Check your connection and repository access, then refresh.')
}
class GitHubClient {
 constructor({run}={}){this.run=run||this.execute.bind(this)}
 async execute(args,{json=true,rateStatus=false,mutation=false}={}){
  if(!rateStatus&&this.retryAt>Date.now())throw Object.assign(failure('GitHub is temporarily limiting requests. Sync is paused.','GITHUB_RATE_LIMITED'),{retryAt:this.retryAt});
  const binary=[...(process.env.PATH||'').split(path.delimiter),'/opt/homebrew/bin','/usr/local/bin',path.join(os.homedir(),'.local/bin')].map(p=>path.join(p,'gh')).find(p=>{try{fs.accessSync(p,fs.constants.X_OK);return true}catch{return false}})
  if(!binary)throw failure('Install GitHub CLI (gh), then sign in with gh auth login in Terminal.')
  try{const {stdout}=await exec(binary,args,{timeout:25000,maxBuffer:3*1024*1024,env:{...process.env,GH_HOST:'github.com',GH_PROMPT_DISABLED:'1',GH_PAGER:'cat',GH_DEBUG:''}});return json?JSON.parse(stdout):stdout}
  catch(e){const classified=classifyFailure(e);if(classified.code==='GITHUB_RATE_LIMITED'){this.retryAt=Math.max(classified.retryAt||0,Date.now()+60000);classified.retryAt=this.retryAt;throw classified}if(mutation)throw failure('GitHub could not confirm the merge. Check permissions, branch rules and the current PR on GitHub before retrying.');if(!json)throw failure(/permission|not accessible|forbidden|HTTP 403/i.test(String(e.stderr||''))?'GitHub denied the close request. Check that your account can close this issue.':'The close request could not be confirmed. Check GitHub or refresh before retrying.');throw classifyFailure(e)}
 }
 async rateLimit(){return this.run(['api','--hostname','github.com','--method','GET','rate_limit'],{rateStatus:true})}
 async login(){const r=await this.run(['api','--hostname','github.com','--method','GET','user']);if(typeof r.login!=='string')throw failure('GitHub did not return an account. Sign in again in Terminal.');return r.login}
 async discover(){const login=await this.login(),repositories=[];let truncated=false
  for(let page=1;page<=5;page++){const rows=await this.run(['api','--hostname','github.com','--method','GET',`user/repos?per_page=100&sort=pushed&page=${page}`]);if(!Array.isArray(rows))throw failure('GitHub returned an invalid repository list.');repositories.push(...rows.filter(r=>!r.archived&&REPO.test(r.full_name)).map(r=>r.full_name));if(rows.length<100)break;if(page===5)truncated=true}
  return{login,repositories:[...new Set(repositories)].sort(),truncated}
 }
 async pulls(repo){if(!REPO.test(repo))throw failure('Enter a repository as owner/name.');const rows=await this.run(['pr','list','--repo','https://github.com/'+repo,'--state','open','--limit','201','--json',fields]);if(!Array.isArray(rows))throw failure('GitHub returned an invalid PR list.');return {rows:rows.slice(0,200),truncated:rows.length>200}}
 async issues(repo){if(!REPO.test(repo))throw failure('Enter a repository as owner/name.');try{const rows=await this.run(['issue','list','--repo','https://github.com/'+repo,'--state','open','--limit','201','--json',issueFields]);if(!Array.isArray(rows))throw failure('GitHub returned an invalid issue list.');return {rows:rows.slice(0,200),truncated:rows.length>200,disabled:false}}catch(e){if(e.code==='GITHUB_ISSUES_DISABLED')return {rows:[],truncated:false,disabled:true};throw e}}
 async issue(repo,number){if(!REPO.test(repo)||!Number.isSafeInteger(number)||number<1)throw failure('Choose a valid issue.');return this.run(['issue','view',String(number),'--repo','https://github.com/'+repo,'--json',issueFields])}
 async closeIssue(repo,number,reason){
  if(!REPO.test(repo)||!Number.isSafeInteger(number)||number<1||!['completed','not_planned'].includes(reason))throw failure('Choose a valid issue and closing reason.');
  await this.run(['issue','close',String(number),'--repo','https://github.com/'+repo,'--reason',reason==='not_planned'?'not planned':'completed'],{json:false})
 }
 async pull(repo,number){if(!REPO.test(repo)||!Number.isSafeInteger(number)||number<1)throw failure('Choose a valid pull request.');return this.run(['pr','view',String(number),'--repo','https://github.com/'+repo,'--json',fields+',mergeable,mergeStateStatus'])}
 async mergePull(repo,number,head,method){
  if(!REPO.test(repo)||!Number.isSafeInteger(number)||number<1||! /^[a-f0-9]{6,64}$/i.test(head)||!['squash','merge','rebase'].includes(method))throw failure('Choose a valid PR, reviewed commit and merge method.');
  return this.run(['api','--hostname','github.com','--method','PUT',`repos/${repo}/pulls/${number}/merge`,'-f',`sha=${head}`,'-f',`merge_method=${method}`],{mutation:true});
 }
}
module.exports={GitHubClient,REPO,classifyFailure}
