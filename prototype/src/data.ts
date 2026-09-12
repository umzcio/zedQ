export type Note = {id:string;title:string;body:string;project:string;updated:string;pinned:boolean}
export const columns = ['Inbox','Next','Doing','Waiting','Done'] as const
export type Status = typeof columns[number]
export type Task = {id:string;title:string;description:string;project:string;status:Status;priority:'Normal'|'High';noteId?:string}
export const projects = ['zQ','llm-img','zBrain']
export const initialNotes:Note[] = [
{id:'n1',title:'A little less scattered.',project:'zQ',updated:'Just now',pinned:true,body:'One place to pick up where I left off.\n\nI keep coming back to this: I don’t need another app to manage. I need a space that brings the things I already do a little closer together.\n\nWhat I want to make room for\n\n→ Thoughts before they disappear\n→ Projects without ten open windows\n→ A clear next step when I sit down\n\nStart small. A good scratchpad. A simple board. Everything else can find its place as we go.\n\nThings to explore\n\n• How should notes and tasks connect?\n• Can the workspace feel familiar on every Mac?\n• Give Herdr a proper look before deciding on Code.'},
{id:'n2',title:'Image pipeline ideas',project:'llm-img',updated:'25 min ago',pinned:true,body:'A place for the next round of image experiments.\n\nTry a smaller batch first, then compare the results side by side.\n\nNext steps\n\n• Pick a consistent set of prompts\n• Keep the originals alongside each variation\n• Write down what actually improved'},
{id:'n3',title:'What should memory remember?',project:'zBrain',updated:'Yesterday',pinned:false,body:'Collecting everything isn’t the same as remembering what matters.\n\nI want to be able to correct something once and have that correction carry across tools.\n\nKeep personal and work context separate. Make the source easy to find.\n\nQuestion: what should be saved automatically, and what should I choose to remember?'},
{id:'n4',title:'Loose ends',project:'',updated:'Yesterday',pinned:false,body:'A small place for the things that don’t have a home yet.\n\n• Clean up the downloads folder\n• Put a little time aside to read about Herdr\n• Decide which machine will keep zQ running'}]
export const initialTasks:Task[] = [
{id:'t1',title:'Give Herdr a proper look',description:'Read the docs and try the workflow before choosing a direction for Code.',project:'zQ',status:'Inbox',priority:'Normal'},
{id:'t2',title:'Collect the next batch of image ideas',description:'Keep a small, repeatable set of prompts for the next experiment.',project:'llm-img',status:'Inbox',priority:'Normal',noteId:'n2'},
{id:'t3',title:'Choose a home for shared notes',description:'Pick the always-on machine and think through backup and recovery.',project:'zQ',status:'Next',priority:'High'},
{id:'t4',title:'Compare memory approaches',description:'Use the same examples to compare retrieval and corrections.',project:'zBrain',status:'Next',priority:'Normal',noteId:'n3'},
{id:'t5',title:'Find the feel of zQ',description:'Try the prototype in both themes. What feels useful? What feels like too much?',project:'zQ',status:'Doing',priority:'High',noteId:'n1'},
{id:'t6',title:'Review the latest image batch',description:'Come back to this when the current run is ready.',project:'llm-img',status:'Waiting',priority:'Normal'},
{id:'t7',title:'Write down the bigger picture',description:'The first working brief is ready to build on.',project:'zQ',status:'Done',priority:'Normal',noteId:'n1'}]
