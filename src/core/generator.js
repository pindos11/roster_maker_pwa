import { uuid, now, monthDates, weekday, seeded, clone } from './utils.js';
import { isUnavailable } from './availability.js';
import { validateVersion } from './validation.js';
export function materialize(roster, rules) { return monthDates(roster.year, roster.month).flatMap(date => rules.filter(rule => rule.generatorEnabled && applies(rule, date)).map(rule => ({ id: uuid(), date, ruleId: rule.id, name: rule.name, locationId: rule.locationId, minStaff: rule.minStaff, maxStaff: rule.maxStaff, color: rule.color || '#B7E1CD', assignments: [] }))); }
function applies(rule, date) { const a = rule.appliesOn || {}; return a.type === 'date-range' ? (!a.startDate || date >= a.startDate) && (!a.endDate || date <= a.endDate) : (a.weekdays || []).includes(weekday(date)); }
const assign = (employeeId, source = 'generated', locked = false) => ({ id: uuid(), employeeId, source, locked, createdAt: now(), updatedAt: now() });
export function generate(roster, prior, rules, employees, availabilities, { fromDate, seed = String(now()), preserveGeneratedAssignments = true, resetGenerated = false } = {}) {
  const target = fromDate || `${roster.year}-${String(roster.month).padStart(2, '0')}-01`;
  let shifts;
  if (!prior) shifts = materialize(roster, rules);
  else if (resetGenerated) {
    const previousGenerated = prior.shifts.filter(shift => !shift.manual);
    const manualShifts = clone(prior.shifts.filter(shift => shift.manual));
    shifts = materialize(roster, rules).map(shift => {
      const previous = previousGenerated.find(old => old.date === shift.date && old.ruleId === shift.ruleId);
      if (previous && shift.date < target) return clone(previous);
      if (previous) shift.assignments = clone(previous.assignments.filter(assignment => assignment.locked));
      return shift;
    }).concat(manualShifts);
  } else shifts = clone(prior.shifts);
  const worked = new Map();
  for (const shift of shifts) for (const a of shift.assignments) if (shift.date < target || a.locked || (preserveGeneratedAssignments && !isUnavailable(availabilities, a.employeeId, shift.date))) worked.set(`${a.employeeId}:${shift.date}`, true);
  for (const shift of shifts.filter(s => s.date >= target)) shift.assignments = shift.assignments.filter(a => a.locked || (preserveGeneratedAssignments && !isUnavailable(availabilities, a.employeeId, shift.date)));
  const count = Object.fromEntries(employees.map(e => [e.id, 0])); for (const shift of shifts) for (const a of shift.assignments) count[a.employeeId] = (count[a.employeeId] || 0) + 1;
  const rng = seeded(seed);
  const ordered = shifts.filter(s => s.date >= target).sort((a, b) => candidateCount(a) - candidateCount(b) || (b.minStaff / b.maxStaff) - (a.minStaff / a.maxStaff));
  function candidateCount(shift) { return employees.filter(e => eligible(e, shift)).length; }
  function eligible(employee, shift) { return (!employee.locationId || employee.locationId === shift.locationId) && !isUnavailable(availabilities, employee.id, shift.date) && !worked.has(`${employee.id}:${shift.date}`) && !shift.assignments.some(a => a.employeeId === employee.id); }
  const targetFor = employee => employee.targetDaysWorked ?? roster.daysWorkedTarget?.[employee.id] ?? roster.targetDaysWorked ?? 0;
  const softLimitFor = employee => employee.maxConsecutiveWorkDays ?? 5;
  const shiftDatesFor = employeeId => shifts.filter(s => s.assignments.some(a => a.employeeId === employeeId)).map(s => s.date);
  const addDays = (date, amount) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10); };
  const resultingRun = (employeeId, date) => { const dates = new Set(shiftDatesFor(employeeId)); let before = 0, after = 0, cursor = addDays(date, -1); while (dates.has(cursor)) { before++; cursor = addDays(cursor, -1); } cursor = addDays(date, 1); while (dates.has(cursor)) { after++; cursor = addDays(cursor, 1); } return before + 1 + after; };
  const spacing = (employeeId, date) => { const dates = shiftDatesFor(employeeId); return dates.length ? Math.min(...dates.map(other => Math.abs(Date.parse(`${date}T00:00:00Z`) - Date.parse(`${other}T00:00:00Z`)))) : Number.MAX_SAFE_INTEGER; };
  function bestShiftFor(employee, respectSoftLimit) { let options = ordered.filter(shift => shift.assignments.length < shift.maxStaff && eligible(employee, shift)); if (respectSoftLimit) { const preferred = options.filter(shift => resultingRun(employee.id, shift.date) <= softLimitFor(employee)); if (preferred.length) options = preferred; else return null; } return options.sort((a, b) => spacing(employee.id, b.date) - spacing(employee.id, a.date) || resultingRun(employee.id, a.date) - resultingRun(employee.id, b.date) || rng() - .5)[0]; }
  for (const shift of ordered) while (shift.assignments.length < shift.minStaff) { const candidates = employees.filter(e => eligible(e, shift)); if (!candidates.length) break; candidates.sort((a, b) => (count[a.id] / (a.targetDaysWorked ?? roster.daysWorkedTarget?.[a.id] ?? roster.targetDaysWorked ?? 1)) - (count[b.id] / (b.targetDaysWorked ?? roster.daysWorkedTarget?.[b.id] ?? roster.targetDaysWorked ?? 1)) || rng() - .5); const employee = candidates[0]; shift.assignments.push(assign(employee.id)); worked.set(`${employee.id}:${shift.date}`, true); count[employee.id]++; }
  // First prefer evenly spaced workdays that stay within each employee's soft run limit.
  // A final pass may exceed that preference, because target completion has higher priority.
  for (const respectSoftLimit of [true, false]) for (;;) { const candidates = employees.filter(employee => count[employee.id] < targetFor(employee)).sort((a, b) => (count[a.id] / Math.max(targetFor(a), 1)) - (count[b.id] / Math.max(targetFor(b), 1)) || rng() - .5); let filled = false; for (const employee of candidates) { const shift = bestShiftFor(employee, respectSoftLimit); if (!shift) continue; shift.assignments.push(assign(employee.id)); worked.set(`${employee.id}:${shift.date}`, true); count[employee.id]++; filled = true; break; } if (!filled) break; }
  const version = { id: prior?.id || uuid(), rosterId: roster.id, status: 'proposal', generatedFromDate: target, generatorSeed: seed, generatorConfig: { preserveGeneratedAssignments }, targetDaysWorked: roster.targetDaysWorked, daysWorkedTarget: roster.daysWorkedTarget, shifts, createdAt: prior?.createdAt || now(), updatedAt: now() };
  version.coverageReport = validateVersion(version, employees, availabilities); return version;
}
export function diff(before, after) { const oldSet = new Set((before?.shifts || []).flatMap(s => s.assignments.map(a => `${s.date}:${s.id}:${a.employeeId}`))); const newSet = new Set(after.shifts.flatMap(s => s.assignments.map(a => `${s.date}:${s.id}:${a.employeeId}`))); return { added: [...newSet].filter(x => !oldSet.has(x)).length, removed: [...oldSet].filter(x => !newSet.has(x)).length, preserved: [...newSet].filter(x => oldSet.has(x)).length, newlyUnfilled: after.coverageReport.unfilledSlots.length }; }
