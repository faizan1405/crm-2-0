import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Lead, Deal, Payment, FollowUp, Note, LeadActivity } from './types';
import { demoLeads, demoDeals, demoPayments, demoFollowUps, demoNotes, demoActivities } from './demo';
import { uid, digits } from './format';
interface CRMState {
 leads: Lead[]; deals: Deal[]; payments: Payment[]; followUps: FollowUp[]; notes: Note[]; activities: LeadActivity[];
 owner: string; business: string; dark: boolean;
 addLead: (lead: Omit<Lead,'id'|'createdAt'|'updatedAt'>)=>string;
 updateLead: (id:string, patch:Partial<Lead>)=>void;
 deleteLead: (id:string)=>void;
 addActivity: (leadId:string,text:string,type?:LeadActivity['type'])=>void;
 addDeal:(deal:Omit<Deal,'id'|'createdAt'>)=>void;
 addPayment:(payment:Omit<Payment,'id'>)=>void;
 voidPayment:(id:string)=>void;
 addFollowUp:(followUp:Omit<FollowUp,'id'>)=>void;
 completeFollowUp:(id:string)=>void;
 rescheduleFollowUp:(id:string,date:string)=>void;
 saveNote:(note:Note)=>void;
 deleteNote:(id:string)=>void;
 preferences:(patch:Partial<Pick<CRMState,'owner'|'business'|'dark'>>)=>void;
 reset:()=>void;
}
export function duplicatePhone(leads:Lead[],phone:string) { return digits(phone).length===10 && leads.some(l=>digits(l.phone)===digits(phone)); }
const initial = {leads:demoLeads,deals:demoDeals,payments:demoPayments,followUps:demoFollowUps,notes:demoNotes,activities:demoActivities,owner:'Faizan',business:'Scale Flow',dark:false};
export const useCRM = create<CRMState>()(persist((set,get)=>({
 ...initial,
 addLead:(lead)=>{const id=uid('lead');const at=new Date().toISOString();set(s=>({leads:[{...lead,id,createdAt:at,updatedAt:at},...s.leads],activities:[{id:uid('activity'),leadId:id,type:'created',text:'Lead added to Scale Flow',at},...s.activities]}));return id;},
 updateLead:(id,patch)=>{set(s=>({leads:s.leads.map(l=>l.id===id?{...l,...patch,updatedAt:new Date().toISOString()}:l)}));if(patch.status)get().addActivity(id,`Status changed to ${patch.status}`,'status');},
 deleteLead:id=>set(s=>({leads:s.leads.filter(l=>l.id!==id),followUps:s.followUps.filter(f=>f.leadId!==id),activities:s.activities.filter(a=>a.leadId!==id)})),
 addActivity:(leadId,text,type='note')=>set(s=>({activities:[{id:uid('activity'),leadId,type,text,at:new Date().toISOString()},...s.activities]})),
 addDeal:deal=>set(s=>({deals:[{...deal,id:uid('deal'),createdAt:new Date().toISOString()},...s.deals]})),
 addPayment:payment=>set(s=>({payments:[{...payment,id:uid('payment')},...s.payments]})),
 voidPayment:id=>set(s=>({payments:s.payments.map(p=>p.id===id?{...p,voided:true}:p)})),
 addFollowUp:f=>set(s=>({followUps:[{...f,id:uid('followup')},...s.followUps]})),
 completeFollowUp:id=>set(s=>({followUps:s.followUps.map(f=>f.id===id?{...f,completedAt:new Date().toISOString()}:f)})),
 rescheduleFollowUp:(id,dueAt)=>set(s=>({followUps:s.followUps.map(f=>f.id===id?{...f,dueAt}:f)})),
 saveNote:note=>set(s=>({notes:s.notes.some(n=>n.id===note.id)?s.notes.map(n=>n.id===note.id?note:n):[note,...s.notes]})),
 deleteNote:id=>set(s=>({notes:s.notes.filter(n=>n.id!==id)})),
 preferences:patch=>set(patch),reset:()=>set(initial),
}),{name:'scale-flow-crm-2-demo',storage:createJSONStorage(()=>localStorage),skipHydration:true}));
