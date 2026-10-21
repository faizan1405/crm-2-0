import type { Lead, Deal, Payment, FollowUp, Note, LeadActivity } from './types';
const now = '2026-10-21T06:00:00Z';
const people = [
  ['Aarav Sharma','Bloom Interiors','Website','proposal','hot',92,85000],
  ['Priya Mehta','Studio Verde','Referral','qualified','hot',88,120000],
  ['Rohan Kapoor','Kapoor & Co.','Instagram','new','warm',74,45000],
  ['Ananya Patel','The Paper House','Google Ads','contacted','warm',79,65000],
  ['Vikram Singh','Northstar Fitness','LinkedIn','won','hot',96,150000],
  ['Neha Gupta','Little Wonders','Website','proposal','hot',86,95000],
  ['Arjun Desai','Desai Ventures','Referral','won','hot',94,180000],
  ['Ishita Rao','Good Earth Café','Instagram','qualified','warm',81,75000],
  ['Kabir Malhotra','Urban Living','WhatsApp','contacted','cold',52,35000],
  ['Sana Khan','Sana Beauty','Google Ads','new','warm',72,55000],
  ['Dev Joshi','Pixel Works','LinkedIn','lost','cold',35,40000],
  ['Mira Shah','Mira Collective','Website','new','hot',89,110000],
] as const;
export const demoLeads: Lead[] = people.map((p,i)=>({ id:`lead_${i+1}`,name:p[0],company:p[1],source:p[2],status:p[3],priority:p[4],aiScore:p[5],quotedAmount:p[6],budget:p[6],phone:`+91 98765 ${String(43010+i).padStart(5,'0')}`,email:p[0].split(' ')[0]?.toLowerCase()+'@example.com',requirement:['Website design & development','Brand identity and digital marketing','CRM implementation'][i%3]!,pinned:i===0||i===5,notes:'Looking for a thoughtful, modern solution. Discuss scope and share a tailored proposal.',createdAt:`2026-10-${String(10+i%10).padStart(2,'0')}T05:00:00Z`,updatedAt:now,lastContact:now,nextFollowUp:'2026-10-21T09:00:00Z'}));
export const demoDeals: Deal[] = [
 {id:'deal_1',leadId:'lead_5',clientType:'crm',clientName:'Vikram Singh',company:'Northstar Fitness',name:'Website & member portal',quotedAmount:165000,finalAmount:150000,status:'active',dueDate:'2026-10-28',milestones:[],createdAt:now},
 {id:'deal_2',leadId:'lead_7',clientType:'crm',clientName:'Arjun Desai',company:'Desai Ventures',name:'Brand & digital launch',quotedAmount:200000,finalAmount:180000,status:'active',dueDate:'2026-10-19',milestones:[],createdAt:now},
 {id:'deal_3',clientType:'other',clientName:'Kavya Nair',company:'Nair Foods',name:'E-commerce storefront',quotedAmount:95000,finalAmount:90000,status:'completed',dueDate:'2026-10-15',milestones:[],createdAt:now},
 {id:'deal_4',clientType:'other',clientName:'Aditya Sethi',company:'Sethi Associates',name:'CRM setup & onboarding',quotedAmount:70000,finalAmount:65000,status:'active',dueDate:'2026-10-25',milestones:[],createdAt:now},
];
export const demoPayments: Payment[] = [
 {id:'pay_1',dealId:'deal_1',amount:75000,date:'2026-10-12',method:'Bank Transfer',type:'advance'},
 {id:'pay_2',dealId:'deal_2',amount:90000,date:'2026-10-10',method:'UPI',type:'advance'},
 {id:'pay_3',dealId:'deal_3',amount:90000,date:'2026-10-14',method:'Bank Transfer',type:'final'},
 {id:'pay_4',dealId:'deal_4',amount:25000,date:'2026-10-18',method:'UPI',type:'advance'},
];
export const demoFollowUps: FollowUp[] = [
 {id:'fu_1',leadId:'lead_1',type:'call',dueAt:'2026-10-21T07:30:00Z',note:'Discuss proposal and project timeline'},
 {id:'fu_2',leadId:'lead_2',type:'meeting',dueAt:'2026-10-21T09:00:00Z',note:'Discovery call with Priya'},
 {id:'fu_3',leadId:'lead_6',type:'whatsapp',dueAt:'2026-10-21T10:30:00Z',note:'Check in on the website proposal'},
 {id:'fu_4',leadId:'lead_4',type:'email',dueAt:'2026-10-20T06:00:00Z',note:'Send portfolio and package details'},
 {id:'fu_5',leadId:'lead_8',type:'call',dueAt:'2026-10-22T05:30:00Z',note:'Review scope for café website'},
];
export const demoNotes: Note[] = [
 {id:'note_1',title:'This week’s priorities',body:'Finalize Bloom Interiors proposal.\nFollow up with Studio Verde.\nCollect outstanding Desai Ventures payment.',pinned:true,tag:'Work',createdAt:now,updatedAt:now},
 {id:'note_2',title:'Discovery call checklist',body:'Understand the business goals.\nAsk about budget and timeline.\nIdentify the decision maker.\nAgree on a clear next step.',pinned:false,tag:'Ideas',createdAt:now,updatedAt:now},
];
export const demoActivities: LeadActivity[] = demoLeads.map(l=>({id:`activity_${l.id}`,leadId:l.id,type:'created',text:'Lead added to Scale Flow',at:l.createdAt}));
