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
    const roster={id:'r',year:2026,month:10,targetDaysWorked:1,daysWorkedTarget:{a:1,b:1}};
    const rules=[{id:'rule',name:'Day',locationId:null,minStaff:1,maxStaff:1,appliesOn:{type:'date-range',startDate:'2026-10-01',endDate:'2026-10-01'}}];
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
});
