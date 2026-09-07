import { openDB } from 'idb';
import { uuid, now, clone } from '../core/utils.js';
const stores = ['locations', 'employees', 'availabilities', 'shiftRules', 'rosters', 'rosterVersions'];
// Version 3 deliberately re-runs the idempotent schema repair for browsers that
// previously opened an incomplete v1/v2 database.
export const dbPromise = openDB('rosterPlanner', 3, { upgrade(db, _oldVersion, _newVersion, upgradeTx) {
  const ensure = (name, indexes = []) => { const target = db.objectStoreNames.contains(name) ? upgradeTx.objectStore(name) : db.createObjectStore(name, { keyPath: 'id' }); indexes.forEach(([index, key]) => { if (!target.indexNames.contains(index)) target.createIndex(index, key); }); };
  ensure('locations');
  ensure('employees', [['name', 'name'], ['locationId', 'locationId']]);
  ensure('availabilities', [['employeeId', 'employeeId'], ['startDate', 'startDate'], ['endDate', 'endDate']]);
  ensure('shiftRules', [['locationId', 'locationId']]);
  ensure('rosters', [['yearMonth', ['year', 'month']]]);
  ensure('rosterVersions', [['rosterId', 'rosterId'], ['rosterStatus', ['rosterId', 'status']]]);
  if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
}});
export async function list(store) { return (await dbPromise).getAll(store); }
export async function get(store, id) { return (await dbPromise).get(store, id); }
export async function save(store, item) { await (await dbPromise).put(store, item); return item; }
export async function remove(store, id) { return (await dbPromise).delete(store, id); }
export async function create(store, values) { return save(store, { id: uuid(), ...values, createdAt: now(), updatedAt: now() }); }
export async function versionsFor(rosterId) { return (await dbPromise).getAllFromIndex('rosterVersions', 'rosterId', rosterId); }
export async function rosterBundle(rosterId) { const roster = await get('rosters', rosterId); return { roster, versions: await versionsFor(rosterId) }; }
export async function transaction(callback) { const db = await dbPromise; const tx = db.transaction([...stores, 'settings'], 'readwrite'); try { const result = await callback(tx); await tx.done; return result; } catch (e) { tx.abort(); throw e; } }
export async function exportBackup() { const data = {}; for (const s of [...stores, 'settings']) data[s] = await list(s); return { schemaVersion: 1, exportedAt: now(), data }; }
export async function replaceBackup(backup) { if (!backup || backup.schemaVersion !== 1 || !backup.data || !stores.every(s => Array.isArray(backup.data[s])) || !Array.isArray(backup.data.settings)) throw new Error('This is not a valid Roster Planner backup.'); return transaction(async tx => { for (const s of [...stores, 'settings']) { const store = tx.objectStore(s); await store.clear(); for (const x of backup.data[s]) await store.put(clone(x)); } }); }
