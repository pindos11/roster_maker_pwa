import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { parseAvailabilityText, isUnavailable } from '../src/core/availability.js';
import { monthDates, normalizedName } from '../src/core/utils.js';
import { generate } from '../src/core/generator.js';
import { create, get, remove } from '../src/db/index.js';

describe('calendar and availability', () => {
  it('normalizes names and validates availability input', () => {
    expect(normalizedName(' Ada   Lovelace ')).toBe('ada lovelace');
    expect(parseAvailabilityText('\uFEFF{"employee_name":"Ada","selected_dates":["2026-10-03"]}').dates).toEqual(['2026-10-03']);
    expect(() => parseAvailabilityText('{"employee_name":"Ada","selected_dates":["bad"]}')).toThrow();
    expect(isUnavailable([{employeeId:'a',startDate:'2026-10-01',endDate:'2026-10-03'}],'a','2026-10-02')).toBe(true);
  });
  it('generates repeatably and respects unavailable dates', () => {
    const roster={id:'r',year:2026,month:10};
    const rules=[{id:'rule',name:'Day',locationId:null,minStaff:1,maxStaff:1,generatorEnabled:true,appliesOn:{type:'date-range',startDate:'2026-10-01',endDate:'2026-10-01'}}];
    const employees=[{id:'a',name:'A',locationId:null},{id:'b',name:'B',locationId:null}];
    const availability=[{employeeId:'a',startDate:'2026-10-01',endDate:'2026-10-01'}];
    expect(generate(roster,null,rules,employees,availability,{seed:'same'}).shifts[0].assignments[0].employeeId).toBe('b');
    expect(monthDates(2026,2)).toHaveLength(28);
  });
  it('persists records into the requested IndexedDB store', async () => {
    const location = await create('locations', { name: 'Test location' });
    expect((await get('locations', location.id)).name).toBe('Test location');
    await remove('locations', location.id);
  });
  it('fills concurrent shift capacity toward individual employee targets', () => {
    const roster={id:'r',year:2026,month:10};
    const rules=[{id:'rule',name:'Day',locationId:null,minStaff:1,maxStaff:2,generatorEnabled:true,appliesOn:{type:'weekdays',weekdays:[0,1,2,3,4,5,6]}}];
    const employees=[{id:'a',name:'A',locationId:null,targetDaysWorked:20},{id:'b',name:'B',locationId:null,targetDaysWorked:20}];
    const shifts=generate(roster,null,rules,employees,[],{seed:'same'}).shifts;
    expect(shifts.flatMap(s=>s.assignments).filter(a=>a.employeeId==='a')).toHaveLength(20);
    expect(shifts.flatMap(s=>s.assignments).filter(a=>a.employeeId==='b')).toHaveLength(20);
    expect(shifts.some(s=>s.assignments.length===2)).toBe(true);
  });
  it('spreads target assignments while respecting the soft consecutive-days preference', () => {
    const roster={id:'r',year:2026,month:10};
    const rules=[{id:'rule',name:'Day',locationId:null,minStaff:0,maxStaff:1,generatorEnabled:true,appliesOn:{type:'weekdays',weekdays:[0,1,2,3,4,5,6]}}];
    const employees=[{id:'a',name:'A',locationId:null,targetDaysWorked:15,maxConsecutiveWorkDays:2}];
    const dates=generate(roster,null,rules,employees,[],{seed:'spread'}).shifts.filter(s=>s.assignments.length).map(s=>s.date);
    let longest=0, current=0, previous=''; for (const date of dates.sort()) { current = previous && Date.parse(`${date}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`) === 86400000 ? current+1 : 1; longest=Math.max(longest,current); previous=date; }
    expect(dates).toHaveLength(15); expect(longest).toBeLessThanOrEqual(2);
  });
});
