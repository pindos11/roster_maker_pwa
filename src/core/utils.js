export const uuid = () => crypto.randomUUID();
export const now = () => Date.now();
export const iso = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
export const dateKey = (date) => date.toISOString().slice(0, 10);
export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const monthDates = (year, month) => Array.from({ length: daysInMonth(year, month) }, (_, i) => `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
export const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const normalizedName = (value) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
export const clone = (value) => structuredClone(value);
export function seeded(seed = 'roster') { let n = [...seed].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0) || 1; return () => ((n = Math.imul(48271, n) | 0) >>> 0) / 2 ** 32; }
export const overlap = (a, b) => a.startDate <= b.endDate && b.startDate <= a.endDate;
