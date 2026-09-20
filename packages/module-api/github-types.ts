import type {CodeAgent, CodeProfile, CodeProject, CodeSession} from './code-types'
export type PRStage = 'Backlog' | 'Needs review' | 'Agent reviewing' | 'Needs your input' | 'Ready to merge'
export interface PRRepository {name:string; issuesError?:string; issuesDisabled?:boolean; issuesCheckedAt?:number; issuesTruncated?:boolean; checkedAt?:number; error?:string; truncated?:boolean}
export interface PRRun {action?:'changes'|'implement';instructions?:string;parentRunId?:string;sessionMode?:'chat'|'terminal';id:string; sessionId?:string; sessionState?:CodeSession['state']; sessionUnavailable?:boolean; endedAt?:number; agent:CodeAgent; profileId:string; projectId:string; state:'starting'|'running'|'needs_input'|'complete'|'failed'|'uncertain'; startedAt:number; report:string; reportTruncated?:boolean; error?:string; head:string}
export interface PullRequestCard {linkedPRIds?:string[];id:string; repo:string; number:number; title:string; url:string; author:string; draft:boolean; state:'OPEN'|'CLOSED'|'MERGED'; head:string; updatedAt:string; review:string; checks?:'none'|'passing'|'failing'|'pending'; requested:boolean; stage:PRStage; runs:PRRun[]; stale?:boolean}
export interface IssueCard extends PullRequestCard {source:'issue';state:'OPEN'|'CLOSED';labels:string[];assignees:string[];stateReason?:string}
export interface CodeTaskCard {linkedPRIds?:string[];id:string;source:'task';title:string;description:string;category:string;stage:PRStage;runs:PRRun[];head:string;state:'OPEN';updatedAt:string}
export interface GitHubBoardSnapshot {retryAt?:number;nextRefreshAt?:number;issues?:IssueCard[];tasks:CodeTaskCard[]; repositories:PRRepository[]; cards:PullRequestCard[]; login:string; projects:CodeProject[]; profiles:CodeProfile[]; contextError?:string}
export interface MergePreview {id:string;runId:string;repo:string;number:number;title:string;head:string;checks?:string;review:string}
export interface GitHubOperations {
 followUp:{input:{id:string;runId:string;action:'changes'|'implement';instructions:string};output:GitHubBoardSnapshot}
 prepareMerge:{input:{id:string;runId:string};output:MergePreview}
 mergePR:{input:{id:string;runId:string;head:string;method:'squash'|'merge'|'rebase'};output:GitHubBoardSnapshot}
 linkPR:{input:{id:string;repo:string;number:number};output:GitHubBoardSnapshot}
 unlinkPR:{input:{id:string;prId:string};output:GitHubBoardSnapshot}
 saveTask:{input:{id?:string;title:string;description:string;category:string;stage:PRStage};output:GitHubBoardSnapshot}
 deleteTask:{input:{id:string};output:GitHubBoardSnapshot}
 snapshot:{input:undefined;output:GitHubBoardSnapshot}
 discover:{input:undefined;output:{repositories:string[];login:string;truncated:boolean}}
 configure:{input:{repositories:string[]};output:GitHubBoardSnapshot}
 refresh:{input:{automatic:boolean}|undefined;output:GitHubBoardSnapshot}
 move:{input:{id:string;stage:PRStage};output:GitHubBoardSnapshot}
 assign:{input:{id:string;agent:CodeAgent;profileId:string;projectId:string};output:GitHubBoardSnapshot}
 closeIssue:{input:{id:string;reason:'completed'|'not_planned'};output:GitHubBoardSnapshot}
 endSession:{input:{id:string;runId:string};output:GitHubBoardSnapshot}
 endTracking:{input:{id:string};output:GitHubBoardSnapshot}
 open:{input:{id:string};output:null}
}
export interface GitHubBridge {invoke:<K extends keyof GitHubOperations>(method:K,input:GitHubOperations[K]['input'])=>Promise<GitHubOperations[K]['output']>}
