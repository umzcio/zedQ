'use strict';
const {randomUUID}=require('node:crypto');
const {z}=require('zod/v4');
const {ConnectorError,boundedJSON}=require('./security.cjs');
const ACTIONS=['create_event','reschedule_event','cancel_event'];
const calendarId=z.string().min(1).max(1024).regex(/^[A-Za-z0-9_@.+-]+$/).default('primary');
const eventId=z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const time=z.union([z.object({date:z.string().date()}).strict(),z.object({dateTime:z.string().datetime({offset:true}),timeZone:z.string().min(1).max(100).optional()}).strict()]);
const reviewToken=z.string().uuid().optional().describe('Managed by zQ; omit this field.');
const schemas={
 create_event:z.object({calendarId,summary:z.string().trim().min(1).max(500),start:time,end:time,description:z.string().max(8000).optional(),location:z.string().max(1000).optional(),attendees:z.array(z.string().email().max(254)).max(25).optional(),reviewToken}).strict(),
 reschedule_event:z.object({calendarId,eventId,start:time,end:time,reviewToken}).strict(),
 cancel_event:z.object({calendarId,eventId,reviewToken}).strict(),
};
const labels={create_event:['Create calendar event','Create this event?'],reschedule_event:['Reschedule calendar event','Reschedule this event?'],cancel_event:['Cancel calendar event','Cancel this event?']};
function checkTimes(start,end){
 if(!!start.date!==!!end.date)throw new ConnectorError('Use either all-day dates or timed start and end values for both ends of the event.');
 if(Date.parse(start.date??start.dateTime)>=Date.parse(end.date??end.dateTime))throw new ConnectorError('The event must end after it starts. All-day end dates are exclusive.');
 for(const value of [start,end])if(value.timeZone){try{new Intl.DateTimeFormat('en-US',{timeZone:value.timeZone})}catch{throw new ConnectorError('Use a valid IANA time zone, such as America/Chicago.')}}
}
function displayTime(start,end,zone){
 start=time.parse(start);end=time.parse(end);checkTimes(start,end);
 if(start.date){const last=new Date(Date.parse(end.date)-86400000).toISOString().slice(0,10);return `All day: ${start.date}${last===start.date?'':` through ${last}`} (${zone})`}
 const format=value=>{const timeZone=value.timeZone??zone;return `${new Intl.DateTimeFormat('en-US',{dateStyle:'full',timeStyle:'long',timeZone}).format(new Date(value.dateTime))} (${timeZone})`};
 return `Start: ${format(start)}\nEnd: ${format(end)}`;
}
const line=value=>String(value??'').replace(/[\r\n\x00-\x1f]/g,' ');
function calendarActions({register,request,signal,calendarWriteAccess}){
 const reviews=new Map();
 const prepare=async(action,input,abortSignal)=>{
  if(!ACTIONS.includes(action))throw new ConnectorError('Unknown Calendar action.');
  const args=schemas[action].parse(input);delete args.reviewToken;
  if(args.start)checkTimes(args.start,args.end);
  if(!calendarWriteAccess())throw new ConnectorError('Reconnect Google Calendar and approve permission to edit events, then try again. Existing calendar reading still works.');
  const combined=AbortSignal.any([signal,abortSignal,AbortSignal.timeout(30000)].filter(Boolean));combined.throwIfAborted();
  const calendar=await request(`users/me/calendarList/${encodeURIComponent(args.calendarId)}`,undefined,combined);
  if(!['owner','writer'].includes(calendar.accessRole))throw new ConnectorError('This calendar is read-only. Choose a calendar you can edit.');
  const zone=calendar.timeZone;if(typeof zone!=='string')throw new ConnectorError('The calendar did not provide a time zone. Open it in Google Calendar.');
  try{new Intl.DateTimeFormat('en-US',{timeZone:zone})}catch{throw new ConnectorError('The calendar returned an unsupported time zone.')}
  const route=`calendars/${encodeURIComponent(args.calendarId)}/events`;
  let event,body,etag;
  if(action==='create_event'){
   body={id:randomUUID().replaceAll('-',''),summary:args.summary,start:args.start,end:args.end,...(args.description!==undefined?{description:args.description}:{}),...(args.location!==undefined?{location:args.location}:{}),...(args.attendees?{attendees:[...new Set(args.attendees)].map(email=>({email}))}:{})};
  }else{
   event=await request(`${route}/${args.eventId}`,undefined,combined);
   if(event.status==='cancelled')throw new ConnectorError('This event is already cancelled.');
   if(event.recurrence?.length)throw new ConnectorError('Choose a single occurrence from list_events. Editing an entire recurring series is not supported yet.');
   if(event.eventType&&event.eventType!=='default')throw new ConnectorError('Change this special event directly in Google Calendar.');
   if(event.organizer?.self!==true)throw new ConnectorError('Choose the organizer’s calendar to change this event. Invitations owned by someone else must be managed in Google Calendar.');
   if(event.attendeesOmitted||event.attendees?.length>50)throw new ConnectorError('This event has too many guests to review fully. Change it in Google Calendar.');
   etag=event.etag;if(typeof etag!=='string'||!etag||etag.length>1024||/[\r\n]/.test(etag))throw new ConnectorError('The event version could not be verified. Reload it before making changes.');
   if(action==='reschedule_event')body={start:args.start,end:args.end};
  }
  // Timed events retain their calendar zone for display and future calendar clients.
  if(body?.start.dateTime)body={...body,start:{...body.start,timeZone:body.start.timeZone??zone},end:{...body.end,timeZone:body.end.timeZone??zone}};
  const guests=action==='create_event'?body.attendees??[]:event.attendees??[];
  if(guests.some(guest=>typeof guest.email!=='string'||guest.email.length>254||/[\r\n]/.test(guest.email)||guest.additionalGuests>0))throw new ConnectorError('Some guests cannot be fully identified for review. Change this event in Google Calendar.');
  const detail=[`Calendar: ${line(calendar.summaryOverride??calendar.summary??calendar.id)} (${line(calendar.id)})`,`Event: ${line(event?.summary??args.summary)}`,event?.recurringEventId?'Only this occurrence of the recurring event.':undefined,
   action==='reschedule_event'?`Before\n${displayTime(event.start,event.end,zone)}\n\nAfter\n${displayTime(body.start,body.end,zone)}`:displayTime((event??body).start,(event??body).end,zone),
   `Location: ${line(event?.location??args.location??'None')}`,`Guests: ${guests.length?guests.map(guest=>guest.email+(guest.optional?' (optional)':'')).join(', '):'None'}`,
   guests.length?`Notifications: ${action==='create_event'?'invitations':action==='cancel_event'?'cancellations':'updates'} will be sent to all guests.`:'Notifications: no guests to notify.',
   action==='cancel_event'?'This event will be removed from the calendar.':undefined,
   action==='create_event'&&args.description?`Description:\n${args.description}`:undefined,
  ].filter(Boolean).join('\n\n');
  if(Buffer.byteLength(detail)>60000)throw new ConnectorError('This event is too large to review fully. Open it in Google Calendar.');
  combined.throwIfAborted();for(const [key,value]of reviews)if(value.expires<Date.now())reviews.delete(key);
  if(reviews.size>=30)throw new ConnectorError('Too many Calendar reviews are pending. Reconnect and try again.');
  const token=randomUUID();reviews.set(token,{action,args:JSON.stringify(args),body,etag,route:action==='create_event'?route:`${route}/${args.eventId}`,expires:Date.now()+600000});
  return {detail,question:labels[action][1],approvalAction:action,arguments:{...args,reviewToken:token}};
 };
 for(const action of ACTIONS)register(action,labels[action][0],`${labels[action][0]} after the user reviews the calendar, times and guests. ${action==='create_event'?'Supply a title, start and end, and optional guest email addresses. All-day end dates are exclusive.':'Use a precise eventId from list_events or get_event. Only a single event or occurrence can be changed.'} Timed values require explicit UTC offsets; use the calendar time zone. Ask a clarifying question if the date, time, calendar, event or intended guests are ambiguous. All guests receive notifications. Never retry an uncertain change automatically.`,schemas[action],async(input,api)=>{
  const {reviewToken:token,...args}=input,review=reviews.get(token);reviews.delete(token);
  if(!review||review.action!==action||review.args!==JSON.stringify(args)||review.expires<Date.now())throw new ConnectorError('Review and approve this Calendar action before making changes.');
  const method={create_event:'POST',reschedule_event:'PATCH',cancel_event:'DELETE'}[action];
  const result=await api(review.route,{sendUpdates:'all',...(action==='reschedule_event'?{conferenceDataVersion:1}:{})},review.body,false,{method,headers:review.etag?{'If-Match':review.etag}:{}});
  if(action!=='cancel_event'&&(!result||result.id!==(action==='create_event'?review.body.id:args.eventId)||result.status==='cancelled'))throw new ConnectorError('The Calendar change could not be confirmed. Check Google Calendar before continuing. Do not retry automatically.');
  return {content:[{type:'text',text:boundedJSON({action,status:action==='cancel_event'?'cancelled':'confirmed',...(result?{event:{id:result.id,summary:result.summary,start:result.start,end:result.end,htmlLink:result.htmlLink}}:{eventId:args.eventId})},20000,'Calendar action result')}]};
 },{readOnlyHint:false,destructiveHint:action!=='create_event',idempotentHint:false,openWorldHint:true});
 return prepare;
}
module.exports={calendarActions,ACTIONS};
