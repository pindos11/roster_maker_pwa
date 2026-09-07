import { openDB } from 'idb';
import { uuid, now, clone } from '../core/utils.js';
const stores = ['locations', 'employees', 'availabilities', 'shiftRules', 'rosters', 'rosterVersions'];
export const dbPromise = openDB('rosterPlanner', 1, { upgrade(db) {
  const location = db.createObjectStore('locations', { keyPath: 'id' });
  const employee = db.createObjectStore('employees', { keyPath: 'id' }); employee.createIndex('name', 'name'); employee.createIndex('locationId', 'locationId');
  const availability = db.createObjectStore('availabilities', { keyPath: 'id' }); availability.createIndex('employeeId', 'employeeId'); availability.createIndex('startDate', 'startDate'); availability.createIndex('endDate', 'endDate');
  const rule = db.createObjectStore('shiftRules', { keyPath: 'id' }); rule.createIndex('locationId', 'locationId');
  const roster = db.createObjectStore('rosters', { keyPath: 'id' }); roster.createIndex('yearMonth', ['year', 'month']);
  const version = db.createObjectStore('rosterVersions', { keyPath: 'id' }); version.createIndex('rosterId', 'rosterId'); version.createIndex('rosterStatus', ['rosterId', 'status']);
  db.createObjectStore('settings', { keyPath: 'key' });
}});
export async function list(store) { return (await dbPromise).getAll(store); }
export async function get(store, id) { return (await dbPromise).get(store, id); }
export async function save(store, item) { await (await dbPromise).put(item); return item; }
export async function remove(store, id) { return (await dbPromise).delete(store, id); }
export async function create(store, values) { return save(store, { id: uuid(), ...values, createdAt: now(), updatedAt: now() }); }
export async function versionsFor(rosterId) { return (await dbPromise).getAllFromIndex('rosterVersions', 'rosterId', rosterId); }
export async function rosterBundle(rosterId) { const roster = await get('rosters', rosterId); return { roster, versions: await versionsFor(rosterId) }; }
export async function transaction(callback) { const db = await dbPromise; const tx = db.transaction([...stores, 'settings'], 'readwrite'); try { const result = await callback(tx); await tx.done; return result; } catch (e) { tx.abort(); throw e; } }
export async function exportBackup() { const data = {}; for (const s of [...stores, 'settings']) data[s] = await list(s); return { schemaVersion: 1, exportedAt: now(), data }; }
export async function replaceBackup(backup) { if (!backup || backup.schemaVersion !== 1 || !backup.data || !stores.every(s => Array.isArray(backup.data[s])) || !Array.isArray(backup.data.settings)) throw new Error('This is not a valid Roster Planner backup.'); return transaction(async tx => { for (const s of [...stores, 'settings']) { const store = tx.objectStore(s); await store.clear(); for (const x of backup.data[s]) await store.put(clone(x)); } }); }
