import { isUnavailable } from './availability.js';
export function validateVersion(version, employees, availabilities) {
  const unfilledSlots = [], conflicts = [], assigned = new Map(), targetDeviation = {};
  for (const shift of version.shifts) {
    if (shift.assignments.length < shift.minStaff) unfilledSlots.push({ shiftId: shift.id, date: shift.date, missing: shift.minStaff - shift.assignments.length });
    if (shift.assignments.length > shift.maxStaff) conflicts.push({ message: `${shift.name} exceeds maximum staffing.` });
    for (const assignment of shift.assignments) {
      const employee = employees.find(e => e.id === assignment.employeeId);
      if (!employee) { conflicts.push({ assignmentId: assignment.id, message: 'Assignment employee no longer exists.' }); continue; }
      if (employee.locationId && employee.locationId !== shift.locationId) conflicts.push({ assignmentId: assignment.id, message: `${employee.name} is assigned outside their location.` });
      if (isUnavailable(availabilities, employee.id, shift.date)) conflicts.push({ assignmentId: assignment.id, message: `${employee.name} is unavailable on ${shift.date}.` });
      const key = `${employee.id}:${shift.date}`; if (assigned.has(key)) conflicts.push({ assignmentId: assignment.id, message: `${employee.name} has more than one shift on ${shift.date}.` }); assigned.set(key, true);
      targetDeviation[employee.id] = (targetDeviation[employee.id] || 0) + 1;
    }
  }
  for (const employee of employees) targetDeviation[employee.id] = (targetDeviation[employee.id] || 0) - (employee.targetDaysWorked ?? 20);
  return { unfilledSlots, conflicts, targetDeviation, generatedAt: Date.now() };
}
