import { iso, monthDates, normalizedName, overlap, uuid, now } from './utils.js';
export const isUnavailable = (entries, employeeId, date) => entries.some(e => e.employeeId === employeeId && e.startDate <= date && e.endDate >= date);
export function parseAvailabilityText(text) {
  let data; try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('The file is not valid JSON.'); }
  if (!data || typeof data.employee_name !== 'string' || !data.employee_name.trim() || !Array.isArray(data.selected_dates)) throw new Error('Expected employee_name and selected_dates.');
  if (data.selected_dates.some(d => typeof d !== 'string' || !iso(d)) || new Set(data.selected_dates).size !== data.selected_dates.length) throw new Error('Dates must be unique YYYY-MM-DD values.');
  if (!data.selected_dates.length) throw new Error('Select at least one available date so the import month can be determined.');
  const months = new Set(data.selected_dates.map(date => date.slice(0, 7)));
  if (months.size !== 1) throw new Error('All selected dates must be in the same month.');
  const [year, month] = [...months][0].split('-').map(Number);
  return { employeeName: data.employee_name.trim(), dates: data.selected_dates, monthStart: `${[...months][0]}-01`, monthEnd: monthDates(year, month).at(-1) };
}
export function makeImportPreview(text, employees, entries) {
  const parsed = parseAvailabilityText(text), key = normalizedName(parsed.employeeName);
  const matches = employees.filter(e => normalizedName(e.name) === key);
  const employee = matches.length === 1 ? matches[0] : null;
  const [year, month] = parsed.monthStart.slice(0, 7).split('-').map(Number);
  const unavailableDates = monthDates(year, month).filter(date => !parsed.dates.includes(date));
  const existing = employee ? unavailableDates.filter(d => isUnavailable(entries, employee.id, d)) : [];
  return { id: uuid(), ...parsed, matches, employeeId: employee?.id, datesToAdd: unavailableDates, alreadyRecorded: existing };
}
export function entriesForImport(preview, employeeId) { return preview.datesToAdd.map(date => ({ id: uuid(), employeeId, startDate: date, endDate: date, status: 'unavailable', source: preview.source || 'file-import', importedAt: now(), createdAt: now() })); }

// The chooser's selected dates mean available.  Import therefore replaces only
// this employee's records within the derived month, retaining any portions of
// ranges outside it, then writes unavailable entries for every unselected day.
export function availabilityImportMutations(preview, employeeId, entries) {
  const affected = entries.filter(entry => entry.employeeId === employeeId && entry.startDate <= preview.monthEnd && entry.endDate >= preview.monthStart);
  const replacements = [];
  for (const entry of affected) {
    if (entry.startDate < preview.monthStart) replacements.push({ ...entry, endDate: previousDate(preview.monthStart) });
    if (entry.endDate > preview.monthEnd) replacements.push({ ...entry, id: uuid(), startDate: nextDate(preview.monthEnd) });
  }
  return { removeIds: affected.map(entry => entry.id), replacements, additions: entriesForImport(preview, employeeId) };
}

function previousDate(date) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10); }
function nextDate(date) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + 1); return value.toISOString().slice(0, 10); }
export { overlap };
