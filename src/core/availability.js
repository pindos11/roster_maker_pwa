import { iso, normalizedName, overlap, uuid, now } from './utils.js';
export const isUnavailable = (entries, employeeId, date) => entries.some(e => e.employeeId === employeeId && e.startDate <= date && e.endDate >= date);
export function parseAvailabilityText(text) {
  let data; try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('The file is not valid JSON.'); }
  if (!data || typeof data.employee_name !== 'string' || !data.employee_name.trim() || !Array.isArray(data.selected_dates)) throw new Error('Expected employee_name and selected_dates.');
  if (data.selected_dates.some(d => typeof d !== 'string' || !iso(d)) || new Set(data.selected_dates).size !== data.selected_dates.length) throw new Error('Dates must be unique YYYY-MM-DD values.');
  return { employeeName: data.employee_name.trim(), dates: data.selected_dates };
}
export function makeImportPreview(text, employees, entries) {
  const parsed = parseAvailabilityText(text), key = normalizedName(parsed.employeeName);
  const matches = employees.filter(e => normalizedName(e.name) === key);
  const employee = matches.length === 1 ? matches[0] : null;
  const existing = employee ? parsed.dates.filter(d => isUnavailable(entries, employee.id, d)) : [];
  return { id: uuid(), ...parsed, matches, employeeId: employee?.id, datesToAdd: parsed.dates.filter(d => !existing.includes(d)), alreadyRecorded: existing };
}
export function entriesForImport(preview, employeeId) { return preview.datesToAdd.map(date => ({ id: uuid(), employeeId, startDate: date, endDate: date, status: 'unavailable', source: 'file-import', importedAt: now(), createdAt: now() })); }
export { overlap };
