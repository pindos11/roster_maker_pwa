import { uuid, now, monthDates, weekday, seeded, clone } from './utils.js';
import { isUnavailable } from './availability.js';
import { validateVersion } from './validation.js';
import { assignmentSet, compareQuality, qualityMetrics } from './quality.js';
export function generatorRulesFor(roster, rules) {
  if (!roster.locationId) throw new Error('A roster must have a location before it can be generated.');
  const matches = rules.filter(rule => rule.generatorEnabled && rule.locationId === roster.locationId);
  if (matches.length !== 1) throw new Error('This roster location needs exactly one generated shift template.');
  return matches;
}
export function materialize(roster, rules) { return monthDates(roster.year, roster.month).flatMap(date => generatorRulesFor(roster, rules).filter(rule => applies(rule, date)).map(rule => ({ id: uuid(), date, ruleId: rule.id, name: rule.name, locationId: rule.locationId, minStaff: rule.minStaff, maxStaff: rule.maxStaff, color: rule.color || '#B7E1CD', assignments: [] }))); }
function applies(rule, date) { const a = rule.appliesOn || {}; return a.type === 'date-range' ? (!a.startDate || date >= a.startDate) && (!a.endDate || date <= a.endDate) : (a.weekdays || []).includes(weekday(date)); }
const assign = (employeeId, source = 'generated', locked = false) => ({ id: uuid(), employeeId, source, locked, createdAt: now(), updatedAt: now() });
export function generate(roster, prior, rules, employees, availabilities, { fromDate, seed = String(now()), preserveGeneratedAssignments = true, resetGenerated = false } = {}) {
  generatorRulesFor(roster, rules);
  const target = fromDate || `${roster.year}-${String(roster.month).padStart(2, '0')}-01`;
  let shifts;
  if (!prior) shifts = materialize(roster, rules);
  else if (resetGenerated) {
    const previousGenerated = prior.shifts.filter(shift => !shift.manual);
    const manualShifts = clone(prior.shifts.filter(shift => shift.manual));
    shifts = materialize(roster, rules).map(shift => {
      const previous = previousGenerated.find(old => old.date === shift.date && old.ruleId === shift.ruleId);
      if (previous && shift.date < target) return clone(previous);
      // The prior proposal is the conservative regeneration baseline. Retain
      // generated work when it remains available; later eligibility checks keep
      // it from conflicting with other assignments on the same day.
      if (previous) shift.assignments = clone(previous.assignments.filter(assignment => assignment.locked || (preserveGeneratedAssignments && !isUnavailable(availabilities, assignment.employeeId, shift.date))));
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
  // Older backups may not have this field. Match the employee form's default
  // instead of treating those employees as having a zero-day target.
  const targetFor = employee => employee.targetDaysWorked ?? 20;
  const softLimitFor = employee => employee.maxConsecutiveWorkDays ?? 5;
  const shiftDatesFor = employeeId => shifts.filter(s => s.assignments.some(a => a.employeeId === employeeId)).map(s => s.date);
  const addDays = (date, amount) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10); };
  const resultingRun = (employeeId, date) => { const dates = new Set(shiftDatesFor(employeeId)); let before = 0, after = 0, cursor = addDays(date, -1); while (dates.has(cursor)) { before++; cursor = addDays(cursor, -1); } cursor = addDays(date, 1); while (dates.has(cursor)) { after++; cursor = addDays(cursor, 1); } return before + 1 + after; };
  const spacing = (employeeId, date) => { const dates = shiftDatesFor(employeeId); return dates.length ? Math.min(...dates.map(other => Math.abs(Date.parse(`${date}T00:00:00Z`) - Date.parse(`${other}T00:00:00Z`)))) : Number.MAX_SAFE_INTEGER; };
  function bestShiftFor(employee, respectSoftLimit) { let options = ordered.filter(shift => shift.assignments.length < shift.maxStaff && eligible(employee, shift)); if (respectSoftLimit) { const preferred = options.filter(shift => resultingRun(employee.id, shift.date) <= softLimitFor(employee)); if (preferred.length) options = preferred; else return null; } return options.sort((a, b) => spacing(employee.id, b.date) - spacing(employee.id, a.date) || resultingRun(employee.id, a.date) - resultingRun(employee.id, b.date) || rng() - .5)[0]; }
  for (const shift of ordered) while (shift.assignments.length < shift.minStaff) { const candidates = employees.filter(e => eligible(e, shift)); if (!candidates.length) break; candidates.sort((a, b) => (count[a.id] / Math.max(targetFor(a), 1)) - (count[b.id] / Math.max(targetFor(b), 1)) || rng() - .5); const employee = candidates[0]; shift.assignments.push(assign(employee.id)); worked.set(`${employee.id}:${shift.date}`, true); count[employee.id]++; }
  // First prefer evenly spaced workdays that stay within each employee's soft run limit.
  // A final pass may exceed that preference, because target completion has higher priority.
  for (const respectSoftLimit of [true, false]) for (;;) { const candidates = employees.filter(employee => count[employee.id] < targetFor(employee)).sort((a, b) => (count[a.id] / Math.max(targetFor(a), 1)) - (count[b.id] / Math.max(targetFor(b), 1)) || rng() - .5); let filled = false; for (const employee of candidates) { const shift = bestShiftFor(employee, respectSoftLimit); if (!shift) continue; shift.assignments.push(assign(employee.id)); worked.set(`${employee.id}:${shift.date}`, true); count[employee.id]++; filled = true; break; } if (!filled) break; }
  const baselineAssignments = assignmentSet(shifts);
  const optimizationReport = optimize(shifts, employees, availabilities, target, baselineAssignments, seeded(`${seed}:soft-v2`));
  const version = { id: prior?.id || uuid(), rosterId: roster.id, status: 'proposal', generatedFromDate: target, generatorSeed: seed, generatorConfig: { preserveGeneratedAssignments, generatorVersion: 'soft-v2' }, optimizationReport, shifts, createdAt: prior?.createdAt || now(), updatedAt: now() };
  version.coverageReport = validateVersion(version, employees, availabilities); return version;
}

function optimize(shifts, employees, availabilities, target, baselineAssignments, rng) {
  const baseline = qualityMetrics(shifts, employees, baselineAssignments);
  let current = baseline, evaluations = 0, movesApplied = 0, stoppedReason = 'no-improvement'; const changes = [];
  const employeeById = new Map(employees.map(employee => [employee.id, employee]));
  const editable = assignment => !assignment.locked && assignment.source === 'generated';
  const canAssign = (employeeId, shift, ignored = new Set()) => {
    const employee = employeeById.get(employeeId);
    if (!employee || (employee.locationId && employee.locationId !== shift.locationId) || isUnavailable(availabilities, employeeId, shift.date)) return false;
    return !shifts.some(other => other.date === shift.date && other.assignments.some(assignment => assignment.employeeId === employeeId && !ignored.has(assignment.id)));
  };
  const candidates = () => {
    const moves = [];
    const editableAssignments = shifts.filter(shift => shift.date >= target && !shift.manual).flatMap(shift => shift.assignments.filter(editable).map(assignment => ({ shift, assignment })));
    for (const { shift, assignment } of editableAssignments) {
      for (const employee of employees) if (employee.id !== assignment.employeeId && canAssign(employee.id, shift, new Set([assignment.id]))) moves.push({ type: 'replace', shiftId: shift.id, assignmentId: assignment.id, employeeId: employee.id });
      if (shift.assignments.length > shift.minStaff) for (const destination of shifts.filter(other => other.date >= target && !other.manual && other.id !== shift.id && other.assignments.length < other.maxStaff)) if (canAssign(assignment.employeeId, destination)) moves.push({ type: 'move', shiftId: shift.id, assignmentId: assignment.id, destinationId: destination.id });
    }
    for (let i = 0; i < editableAssignments.length; i++) for (let j = i + 1; j < editableAssignments.length; j++) {
      const left = editableAssignments[i], right = editableAssignments[j];
      if (left.shift.date === right.shift.date || left.assignment.employeeId === right.assignment.employeeId) continue;
      const ignored = new Set([left.assignment.id, right.assignment.id]);
      if (canAssign(right.assignment.employeeId, left.shift, ignored) && canAssign(left.assignment.employeeId, right.shift, ignored)) moves.push({ type: 'swap', left: { shiftId: left.shift.id, assignmentId: left.assignment.id }, right: { shiftId: right.shift.id, assignmentId: right.assignment.id } });
    }
    return moves.sort((a, b) => (rng() - .5) || a.type.localeCompare(b.type));
  };
  const apply = move => {
    const shiftFor = id => shifts.find(shift => shift.id === id);
    const assignmentFor = (shiftId, assignmentId) => shiftFor(shiftId)?.assignments.find(assignment => assignment.id === assignmentId);
    if (move.type === 'replace') { assignmentFor(move.shiftId, move.assignmentId).employeeId = move.employeeId; return; }
    if (move.type === 'move') { const shift = shiftFor(move.shiftId), assignment = assignmentFor(move.shiftId, move.assignmentId); shift.assignments = shift.assignments.filter(item => item.id !== assignment.id); shiftFor(move.destinationId).assignments.push(assignment); return; }
    const left = assignmentFor(move.left.shiftId, move.left.assignmentId), right = assignmentFor(move.right.shiftId, move.right.assignmentId); const employeeId = left.employeeId; left.employeeId = right.employeeId; right.employeeId = employeeId;
  };
  const describe = move => {
    const shiftFor = id => shifts.find(shift => shift.id === id), assignmentFor = (shiftId, assignmentId) => shiftFor(shiftId)?.assignments.find(assignment => assignment.id === assignmentId);
    if (move.type === 'replace') { const shift = shiftFor(move.shiftId), assignment = assignmentFor(move.shiftId, move.assignmentId); return { type: 'replace', date: shift.date, fromEmployeeId: assignment.employeeId, toEmployeeId: move.employeeId }; }
    if (move.type === 'move') { const shift = shiftFor(move.shiftId), assignment = assignmentFor(move.shiftId, move.assignmentId); return { type: 'move', fromDate: shift.date, toDate: shiftFor(move.destinationId).date, employeeId: assignment.employeeId }; }
    const left = assignmentFor(move.left.shiftId, move.left.assignmentId), right = assignmentFor(move.right.shiftId, move.right.assignmentId); return { type: 'swap', leftDate: shiftFor(move.left.shiftId).date, rightDate: shiftFor(move.right.shiftId).date, leftEmployeeId: left.employeeId, rightEmployeeId: right.employeeId };
  };
  for (;;) {
    let best = null;
    for (const move of candidates()) {
      if (++evaluations > 5000) { stoppedReason = 'evaluation-cap'; break; }
      const snapshot = clone(shifts); apply(move);
      const score = qualityMetrics(shifts, employees, baselineAssignments);
      if (compareQuality(score, current) < 0 && (!best || compareQuality(score, best.score) < 0)) best = { move, score };
      shifts.splice(0, shifts.length, ...snapshot);
    }
    if (evaluations > 5000 || !best) break;
    changes.push(describe(best.move)); apply(best.move); current = best.score; movesApplied++;
  }
  return { baseline, final: current, movesApplied, evaluations, stoppedReason, changes };
}
export function diff(before, after) { const oldSet = new Set((before?.shifts || []).flatMap(s => s.assignments.map(a => `${s.date}:${s.id}:${a.employeeId}`))); const newSet = new Set(after.shifts.flatMap(s => s.assignments.map(a => `${s.date}:${s.id}:${a.employeeId}`))); return { added: [...newSet].filter(x => !oldSet.has(x)).length, removed: [...oldSet].filter(x => !newSet.has(x)).length, preserved: [...newSet].filter(x => oldSet.has(x)).length, newlyUnfilled: after.coverageReport.unfilledSlots.length }; }
