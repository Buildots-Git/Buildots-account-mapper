import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { parseSfJson, CLI_ENV } from './sfjson.js';

const run = promisify(execFile);
const org = () => process.env.SF_ORG || 'prod';
const API = 'v67.0';

// All Salesforce access goes through the sf CLI, which owns login and token refresh.
// (`sf org display` hands back a redacted token, so we never handle access tokens ourselves.)
async function sf(args) {
  try {
    const { stdout } = await run('sf', [...args, '--target-org', org(), '--json'], { maxBuffer: 256 * 1024 * 1024, env: CLI_ENV });
    return parseSfJson(stdout).result;
  } catch (e) {
    let msg = e.message;
    try { msg = parseSfJson(e.stdout).message || msg; } catch {}
    throw new Error(msg.split('\n')[0]);
  }
}
const query = async (soql) => ({ records: (await sf(['data', 'query', '--query', soql])).records });
// `sf api request rest` prints the raw response body (no --json flag); an empty body means success (e.g. PATCH -> 204).
async function rest(path, method = 'GET', body) {
  try {
    const { stdout } = await run('sf', ['api', 'request', 'rest', `/services/data/${API}${path}`, '--method', method, ...(body ? ['--body', JSON.stringify(body)] : []), '--target-org', org()], { maxBuffer: 256 * 1024 * 1024, env: CLI_ENV });
    const t = stdout.trim(); return t ? JSON.parse(t) : {};
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`;
    const m = out.match(/"message"\s*:\s*"([^"]+)"/);
    throw new Error(m ? m[1] : e.message.split('\n')[0]);
  }
}

// Throws if the CLI isn't logged in; used by the status check.
export function getConn() {
  const out = parseSfJson(execFileSync('sf', ['org', 'display', '--target-org', org(), '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, env: CLI_ENV }));
  if (out.result?.connectedStatus && out.result.connectedStatus !== 'Connected') throw new Error('sf org not connected');
  return true;
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const idList = (ids) => ids.map((i) => `'${esc(i)}'`).join(',');

export async function searchAccounts(q) {
  const term = esc(q.trim());
  const where = term ? `WHERE Name LIKE '%${term}%'` : 'WHERE Sales_Focus__c = true';
  const r = await query(`SELECT Id, Name, Industry, BillingCountry, Type, Target_Account__c, Sales_Focus__c, NumberOfEmployees FROM Account ${where} ORDER BY Name LIMIT 25`).catch(async () =>
    query(`SELECT Id, Name, Industry, BillingCountry FROM Account ${term ? where : ''} ORDER BY Name LIMIT 25`));
  return r.records.map(({ attributes, ...a }) => a);
}

const strip = (rs) => rs.map(({ attributes, ...r }) => r);

// Fields of Contact the signed-in Salesforce user can see (respects field-level security).
let catalog, catalogAt = 0;
export async function contactFields() {
  if (catalog && Date.now() - catalogAt < 3600_000) return catalog;
  const d = await rest('/sobjects/Contact/describe');
  catalog = d.fields.filter((f) => !['address', 'location', 'base64', 'anyType', 'complexvalue'].includes(f.type) && !f.deprecatedAndHidden)
    .map((f) => ({ name: f.name, label: f.label, type: f.type })).sort((a, b) => a.label.localeCompare(b.label));
  catalogAt = Date.now();
  return catalog;
}

const BASE = ['Id', 'Name', 'Title', 'Department', 'Email', 'Phone', 'MailingCity', 'MailingState', 'MailingCountry', 'ReportsToId', 'AccountId',
  'Region__c', 'Contact_Role__c', 'ES_Expansion_Status__c', 'Enterprise_Coalition_Member__c', 'ES_Expansion_Contact__c', 'Linkedin_Profile_URL__c', 'Project_Leads_Summary__c', 'Number_of_Activities__c'];

export async function loadAccount(id, extraFields = []) {
  const c = { query };
  const acc = (await c.query(`SELECT Id, Name, Type, Industry, Website, NumberOfEmployees, AnnualRevenue, Description, BillingCity, BillingState, BillingCountry, Owner.Name, Parent.Name, ParentId, Target_Account__c, Sales_Focus__c, Strategic_Account__c FROM Account WHERE Id='${esc(id)}'`)).records[0];
  if (!acc) throw new Error('Account not found');
  const kidRecs = (await c.query(`SELECT Id, Target_Account__c, Sales_Focus__c FROM Account WHERE ParentId='${esc(id)}' LIMIT 200`)).records;
  const kids = kidRecs.map((r) => r.Id);
  const flagged = new Set([acc, ...kidRecs].filter((a) => a.Target_Account__c || a.Sales_Focus__c).map((a) => a.Id));
  const ids = idList([id, ...kids]);

  // Only fields that exist in the describe are ever interpolated into SOQL.
  const allowed = new Set((await contactFields()).map((f) => f.name));
  const select = [...new Set([...BASE, ...extraFields.filter((f) => allowed.has(f))])].join(', ');
  const contacts = (await c.query(`SELECT ${select}, Owner.Name FROM Contact WHERE AccountId IN (${ids}) ORDER BY Name LIMIT 2000`)).records;

  const [ocr, opps, pr, csr, leadsByAcct, csByAcct] = await Promise.all([
    c.query(`SELECT ContactId, Role, Opportunity.Id, Opportunity.Name, Opportunity.StageName, Opportunity.Amount, Opportunity.CloseDate
               FROM OpportunityContactRole WHERE Contact.AccountId IN (${ids}) LIMIT 5000`).then((r) => r.records).catch(() => []),
    c.query(`SELECT Id, Name, StageName, Amount, CloseDate FROM Opportunity WHERE AccountId IN (${ids}) ORDER BY CloseDate DESC LIMIT 200`).then((r) => r.records).catch(() => []),
    c.query(`SELECT Contact__c, Role__c, Contact_Role__c, Projects_Lead__c, Projects_Lead__r.Name FROM Project_Roles__c WHERE Contact__r.AccountId IN (${ids}) LIMIT 5000`).then((r) => r.records).catch(() => []),
    c.query(`SELECT Contact__c, Contact_Role__c, CS_Project__c, CS_Project__r.Name, CS_Project__r.Status__c FROM CS_Project_Contact_Role__c WHERE Contact__r.AccountId IN (${ids}) LIMIT 5000`).then((r) => r.records).catch(() => []),
    c.query(`SELECT Id, Name FROM Projects_Lead__c WHERE Client__c IN (${ids}) OR General_Contractor__c IN (${ids}) LIMIT 200`).then((r) => r.records).catch(() => []),
    c.query(`SELECT Id, Name, Status__c FROM CS_Project__c WHERE Account__c IN (${ids}) LIMIT 200`).then((r) => r.records).catch(() => []),
  ]);

  // Normalise the role/junction rows into entity lists, each carrying the contacts attached to it.
  const group = (rows, key, mk) => {
    const m = new Map();
    for (const r of rows) {
      const k = r[key]; if (!k) continue;
      if (!m.has(k)) m.set(k, mk(r));
      m.get(k).contactIds.push(r.Contact__c || r.ContactId);
    }
    return m;
  };
  const oppMap = new Map(opps.map((o) => [o.Id, { Id: o.Id, Name: o.Name, StageName: o.StageName, Amount: o.Amount, CloseDate: o.CloseDate, contactIds: [] }]));
  for (const r of ocr) {
    const o = r.Opportunity; if (!o) continue;
    if (!oppMap.has(o.Id)) oppMap.set(o.Id, { Id: o.Id, Name: o.Name, StageName: o.StageName, Amount: o.Amount, CloseDate: o.CloseDate, contactIds: [] });
    oppMap.get(o.Id).contactIds.push(r.ContactId);
  }
  const plMap = group(pr, 'Projects_Lead__c', (r) => ({ Id: r.Projects_Lead__c, Name: r.Projects_Lead__r?.Name, Role: r.Role__c || r.Contact_Role__c, contactIds: [] }));
  for (const l of leadsByAcct) if (!plMap.has(l.Id)) plMap.set(l.Id, { Id: l.Id, Name: l.Name, contactIds: [] });
  const csMap = group(csr, 'CS_Project__c', (r) => ({ Id: r.CS_Project__c, Name: r.CS_Project__r?.Name, Status: r.CS_Project__r?.Status__c, Role: r.Contact_Role__c, contactIds: [] }));
  for (const p of csByAcct) if (!csMap.has(p.Id)) csMap.set(p.Id, { Id: p.Id, Name: p.Name, Status: p.Status__c, contactIds: [] });

  return {
    account: { Id: acc.Id, Name: acc.Name, Industry: acc.Industry, BillingCountry: acc.BillingCountry, Target_Account__c: acc.Target_Account__c, Sales_Focus__c: acc.Sales_Focus__c,
      Type: acc.Type, Website: acc.Website, NumberOfEmployees: acc.NumberOfEmployees, AnnualRevenue: acc.AnnualRevenue, Description: acc.Description,
      BillingCity: acc.BillingCity, BillingState: acc.BillingState, Owner: acc.Owner?.Name, Parent: acc.Parent?.Name, Strategic_Account__c: acc.Strategic_Account__c },
    // Target marker = the contact's account is a Target Account or Sales Focus account. (Separate from ECM, the contact's own flag.)
    contacts: strip(contacts).map((k) => ({ ...k, Account_Target: flagged.has(k.AccountId) })),
    opportunities: [...oppMap.values()],
    projectLeads: [...plMap.values()],
    csProjects: [...csMap.values()],
  };
}

const WRITABLE = new Set(['ReportsToId', 'Region__c', 'Contact_Role__c', 'ES_Expansion_Status__c']);
export async function updateContacts(changes) {
  const out = [];
  for (const { Id, ...f } of changes) {
    const clean = Object.fromEntries(Object.entries(f).filter(([k]) => WRITABLE.has(k)));
    try { await rest(`/sobjects/Contact/${encodeURIComponent(Id)}`, 'PATCH', clean); out.push({ id: Id, success: true }); }
    catch (e) { out.push({ id: Id, success: false, error: e.message }); }
  }
  return out;
}

/** Account details for a set of ids (used to label boards that were saved before the homepage existed). */
export async function accountsByIds(ids) {
  const ok = ids.filter((i) => /^[a-zA-Z0-9]{15,18}$/.test(i)); if (!ok.length) return [];
  const r = await query(`SELECT Id, Name, Industry, BillingCountry, Type, Target_Account__c, Sales_Focus__c FROM Account WHERE Id IN (${ok.map((i) => `'${i}'`).join(',')})`);
  return r.records.map(({ attributes, ...a }) => a);
}
