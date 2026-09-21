// Native notifications use state transitions, never persisted transcript text.
class AppNotifications{
 constructor({Notification,enabled,visible,open}){Object.assign(this,{Notification,enabled,visible,open});this.researchStates=new Map();this.codeStates=new Map();this.taskStates=new Map();this.live=new Set()}
 show(kind,title,body,target,{test=false}={}){
  if(this.live.size>=5||!this.Notification.isSupported()||!test&&(!this.enabled(kind)||this.visible()))return;
  let notification;try{notification=new this.Notification({title,body,silent:false});this.live.add(notification);
  const release=()=>this.live.delete(notification);notification.on('close',release);notification.on('failed',release);notification.on('click',()=>{release();this.open(target)});notification.show();return notification}catch{if(notification)this.live.delete(notification);/* Notification failures cannot affect the underlying work. */}
 }
 research(job){if(!job)return;const previous=this.researchStates.get(job.id);this.researchStates.set(job.id,job.status);if(previous&&previous!=='completed'&&job.status==='completed')this.show('research','Research finished','Your report is ready in Chat.',{view:'Chat',id:job.conversationId})}
 code(snapshot){const next=new Map();for(const session of snapshot.sessions??[]){next.set(session.id,session.state);const previous=this.codeStates.get(session.id);if(previous&&!session.archivedAt&&session.adapter!=='terminal'&&(session.state==='approval'&&previous!=='approval'||session.state==='ready'&&previous==='busy'))this.show('agents','Agent needs review','Open the agent session to continue.',{view:'Code',id:session.id})}this.codeStates=next}
 tasks(rows,{code=false}={}){const prefix=code?'code:':'tasks:';const present=new Set();for(const task of rows){const id=prefix+task.id;present.add(id);const done=code?task.stage==='Ready to merge':task.status==='Done';const previous=this.taskStates.get(id);this.taskStates.set(id,done);if(previous===false&&done)this.show('tasks','Task completed',code?'A Code task moved to Done.':'A task moved to Done.',{view:code?'Code':'Tasks'})}for(const id of this.taskStates.keys())if(id.startsWith(prefix)&&!present.has(id))this.taskStates.delete(id)}
 close(){for(const notification of this.live)notification.close();this.live.clear()}
}
module.exports={AppNotifications};
