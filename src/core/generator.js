import { uuid, now, monthDates, weekday, seeded, clone } from './utils.js';
import { isUnavailable } from './availability.js';
import { validateVersion } from './validation.js';
export function materialize(roster, rules) { return monthDates(roster.year, roster.month).flatMap(date => rules.filter(rule => applies(rule, date)).map(rule => ({ id: uuid(), date, ruleId: rule.id, name: rule.name, locationId: rule.locationId, minStaff: rule.minStaff, maxStaff: rule.maxStaff, assignments: [] }))); }
function applies(rule, date) { const a = rule.appliesOn || {}; return a.type === 'date-range' ? (!a.startDate || date >= a.startDate) && (!a.endDate || date <= a.endDate) : (a.weekdays || []).includes(weekday(date)); }
const assign = (employeeId, source = 'generated', locked = false) => ({ id: uuid(), employeeId, source, locked, createdAt: now(), updatedAt: now() });
export function generate(roster, prior, rules, employees, availabilities, { fromDate, seed = String(now()), preserveGeneratedAssignments = true } = {}) {
  const target = fromDate || `${roster.year}-${String(roster.month).padStart(2, '0')}-01`;
  const shifts = prior ? clone(prior.shifts) : materialize(roster, rules);
  const worked = new Map();
  for (const shift of shifts) for (const a of shift.assignments) if (shift.date < target || a.locked || (preserveGeneratedAssignments && !isUnavailable(availabilities, a.employeeId, shift.date))) worked.set(`${a.employeeId}:${shift.date}`, true);
  for (const shift of shifts.filter(s => s.date >= target)) shift.assignments = shift.assignments.filter(a => a.locked || (preserveGeneratedAssignments && !isUnavailable(availabilities, a.employeeId, shift.date)));
  const count = Object.fromEntries(employees.map(e => [e.id, 0])); for (const shift of shifts) for (const a of shift.assignments) count[a.employeeId] = (count[a.employeeId] || 0) + 1;
  const rng = seeded(seed);
  const ordered = shifts.filter(s => s.date >= target).sort((a, b) => candidateCount(a) - candidateCount(b) || (b.minStaff / b.maxStaff) - (a.minStaff / a.maxStaff));
  function candidateCount(shift) { return employees.filter(e => eligible(e, shift)).length; }
  function eligible(employee, shift) { return (!employee.locationId || employee.locationId === shift.locationId) && !isUnavailable(availabilities, employee.id, shift.date) && !worked.has(`${employee.id}:${shift.date}`) && !shift.assignments.some(a => a.employeeId === employee.id); }
  for (const shift of ordered) while (shift.assignments.length < shift.minStaff) { const candidates = employees.filter(e => eligible(e, shift)); if (!candidates.length) break; candidates.sort((a, b) => (count[a.id] / (roster.daysWorkedTarget?.[a.id] || roster.targetDaysWorked || 1)) - (count[b.id] / (roster.daysWorkedTarget?.[b.id] || roster.targetDaysWorked || 1)) || rng() - .5); const employee = candidates[0]; shift.assignments.push(assign(employee.id)); worked.set(`${employee.id}:${shift.date}`, true); count[employee.id]++; }
  const version = { id: prior?.id || uuid(), rosterId: roster.id, status: 'proposal', generatedFromDate: target, generatorSeed: seed, generatorConfig: { preserveGeneratedAssignments }, targetDaysWorked: roster.targetDaysWorked, daysWorkedTarget: roster.daysWorkedTarget, shifts, createdAt: prior?.createdAt || now(), updatedAt: now() };
  version.coverageReport = validateVersion(version, employees, availabilities); return version;
}
export function diff(before, after) { const oldSet = new Set((before?.shifts || []).flatMap(s => s.assignments.map(a => `${s.date}:${s.id}:${a.employeeId}`))); const newSet = new Set(after.shifts.flatMap(s => s.assignments.map(a => `${s.date}:${s.id}:${a.employeeId}`))); return { added: [...newSet].filter(x => !oldSet.has(x)).length, removed: [...oldSet].filter(x => !newSet.has(x)).length, preserved: [...newSet].filter(x => oldSet.has(x)).length, newlyUnfilled: after.coverageReport.unfilledSlots.length }; }
