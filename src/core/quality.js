const targetFor = employee => employee.targetDaysWorked ?? 20;
const consecutiveLimitFor = employee => employee.maxConsecutiveWorkDays ?? 5;

export function assignmentKey(shift, assignment) { return `${shift.id}:${assignment.employeeId}`; }

export function assignmentSet(shifts) {
  return new Set(shifts.flatMap(shift => shift.assignments
    .filter(assignment => !assignment.locked && assignment.source === 'generated')
    .map(assignment => assignmentKey(shift, assignment))));
}

export function qualityMetrics(shifts, employees, baselineAssignments = new Set()) {
  const workedDates = new Map(employees.map(employee => [employee.id, new Set()]));
  let coverageGaps = 0;
  for (const shift of shifts) {
    coverageGaps += Math.max(0, shift.minStaff - shift.assignments.length);
    for (const assignment of shift.assignments) {
      if (!workedDates.has(assignment.employeeId)) workedDates.set(assignment.employeeId, new Set());
      workedDates.get(assignment.employeeId).add(shift.date);
    }
  }
  let targetDeviation = 0, consecutiveExcess = 0;
  for (const employee of employees) {
    const dates = [...(workedDates.get(employee.id) || [])].sort();
    targetDeviation += Math.abs(dates.length - targetFor(employee));
    let run = 0, previous = '';
    for (const date of dates) {
      run = previous && Date.parse(`${date}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`) === 86400000 ? run + 1 : 1;
      previous = date;
      if (run > consecutiveLimitFor(employee)) consecutiveExcess++;
    }
  }
  const current = assignmentSet(shifts);
  let changes = 0;
  for (const key of current) if (!baselineAssignments.has(key)) changes++;
  for (const key of baselineAssignments) if (!current.has(key)) changes++;
  return { coverageGaps, targetDeviation, consecutiveExcess, changes };
}

export function compareQuality(left, right) {
  for (const key of ['coverageGaps', 'targetDeviation', 'consecutiveExcess', 'changes']) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  return 0;
}
