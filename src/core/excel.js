import { monthDates } from './utils.js';

const excelColor = color => `FF${(color || '#FFFFFF').replace('#', '').toUpperCase()}`;

export async function exportRosterWorkbook(roster, version, employees, settings = {}) {
  const { default: ExcelJS } = await import('exceljs');
  const dates = monthDates(roster.year, roster.month);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Roster');
  sheet.addRow(['Employee', ...dates.map(date => Number(date.slice(8)))]);
  const employeeColor = settings.employeeColumnColor || '#D9EAF7';
  employees.forEach((employee, index) => {
    const row = index + 2;
    const nameCell = sheet.getCell(row, 1);
    nameCell.value = employee.name;
    nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: excelColor(employeeColor) } };
    nameCell.font = { bold: true };
    dates.forEach((date, column) => {
      const shift = version.shifts.find(item => item.date === date && item.assignments.some(assignment => assignment.employeeId === employee.id));
      if (!shift) return;
      const cell = sheet.getCell(row, column + 2);
      cell.value = 'W';
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: excelColor(shift.color || '#B7E1CD') } };
      cell.alignment = { horizontal: 'center' };
    });
  });
  sheet.columns = [{ width: 24 }, ...dates.map(() => ({ width: 5 }))];
  const bytes = await workbook.xlsx.writeBuffer();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  link.download = `${roster.name.replace(/[^a-z0-9]+/gi, '_')}_${roster.year}-${String(roster.month).padStart(2, '0')}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}
