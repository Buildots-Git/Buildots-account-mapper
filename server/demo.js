// Fictional account from the Miro example (Meridian Health Systems).
const c = (id, name, title, o = {}) => ({
  Id: id, Name: name, Title: title, ReportsToId: null, Region__c: null, Contact_Role__c: null,
  ES_Expansion_Status__c: null, Enterprise_Coalition_Member__c: false, Account_Target: true, Department: null,
  Email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@meridianhealth.example`, Phone: null,
  MailingCity: null, MailingCountry: 'United States', Linkedin_Profile_URL__c: null, Owner: { Name: 'Rotem Valdman' }, ...o,
});

export const demoAccounts = [{ Id: 'demo-meridian', Name: 'Meridian Health Systems', Industry: 'Construction', Target_Account__c: true, BillingCountry: 'US', Type: 'General Contractor', Website: 'https://example.com', NumberOfEmployees: 3200, AnnualRevenue: 1800000000, BillingCity: 'Denver', Owner: 'Demo Owner', Description: 'Fictional hospital GC used for the demo.' }];

export const demoAccountData = {
  account: demoAccounts[0],
  contacts: [
    c('c1', 'Carol Whitfield', 'Chief Executive Officer', { Contact_Role__c: 'Executive Sponsor', ES_Expansion_Status__c: 'Advocate', Enterprise_Coalition_Member__c: true }),
    c('c2', 'Marcus Deng', 'Chief Operating Officer', { Contact_Role__c: 'Decision Maker', ES_Expansion_Status__c: 'Involved', Enterprise_Coalition_Member__c: true }),
    c('c3', 'Renata Cole', 'Chief Financial Officer', { Contact_Role__c: 'Economic Buyer', ES_Expansion_Status__c: 'Buyer', Enterprise_Coalition_Member__c: true }),
    c('c4', 'Priya Sharma', 'Chief Innovation Officer', { Contact_Role__c: 'Technical Buyer', ES_Expansion_Status__c: 'Aware', Enterprise_Coalition_Member__c: true }),
    c('c5', 'Lena Boyer', 'General Counsel', { Contact_Role__c: 'Other', ES_Expansion_Status__c: 'Targeted' }),
    c('c6', 'Dana Okafor', 'West Region President', { Region__c: 'West', Contact_Role__c: 'Champion', ES_Expansion_Status__c: 'Advocate', Enterprise_Coalition_Member__c: true }),
    c('c7', 'Victor Simmons', 'East Region President', { Region__c: 'East', Contact_Role__c: 'Influencer', ES_Expansion_Status__c: 'Involved', Enterprise_Coalition_Member__c: true }),
    c('c8', 'Bruce Lindqvist', 'Project Executive — Meridian West Data Center Campus', { Region__c: 'West', MailingCity: 'Denver' }),
    c('c9', 'Nora Trent', 'Project Executive', { Region__c: 'West', MailingCity: 'Phoenix' }),
    c('c10', 'Alex Breitenbach', 'Project Executive — Huge Data Center', { Region__c: 'East', MailingCity: 'Atlanta' }),
  ],
  opportunities: [
    { Id: 'o1', Name: 'Meridian – Enterprise Agreement', StageName: 'Negotiation', Amount: 1200000, CloseDate: '2026-12-15', contactIds: ['c1', 'c2', 'c3'] },
    { Id: 'o2', Name: 'Meridian West Data Center', StageName: 'Proposal', Amount: 180000, CloseDate: '2026-11-30', contactIds: ['c6', 'c8'] },
  ],
  projectLeads: [
    { Id: 'p1', Name: 'Meridian West Data Center Campus', Role: 'Project Executive', contactIds: ['c8'] },
    { Id: 'p2', Name: 'Huge Data Center (Atlanta)', Role: 'Project Executive', contactIds: ['c10'] },
  ],
  csProjects: [
    { Id: 's1', Name: 'Meridian Phoenix Clinic', Status: 'Delivery', Role: 'Champion', contactIds: ['c9'] },
  ],
};

export const demoFields = [
  ['Title', 'Title'], ['Email', 'Email'], ['Phone', 'Business Phone'], ['MailingCity', 'Mailing City'], ['Department', 'Department'],
  ['Linkedin_Profile_URL__c', 'Linkedin Profile URL'], ['Region__c', 'Region'],
].map(([name, label]) => ({ name, label, type: 'string' }));
