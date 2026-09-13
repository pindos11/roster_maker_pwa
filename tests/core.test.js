import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { parseAvailabilityText, isUnavailable } from '../src/core/availability.js';
import { monthDates, normalizedName } from '../src/core/utils.js';
import { generate } from '../src/core/generator.js';
import { compareQuality, qualityMetrics } from '../src/core/quality.js';
import { create, get, remove } from '../src/db/index.js';

describe('calendar and availability', () => {
  it('normalizes names and validates availability input', () => {
    expect(normalizedName(' Ada   Lovelace ')).toBe('ada lovelace');
    expect(parseAvailabilityText('\uFEFF{"employee_name":"Ada","selected_dates":["2026-10-03"]}').dates).toEqual(['2026-10-03']);
    expect(() => parseAvailabilityText('{"employee_name":"Ada","selected_dates":["bad"]}')).toThrow();
    expect(isUnavailable([{employeeId:'a',startDate:'2026-10-01',endDate:'2026-10-03'}],'a','2026-10-02')).toBe(true);
  });
  it('generates repeatably and respects unavailable dates', () => {
    const roster={id:'r',locationId:'north',year:2026,month:10};
    const rules=[{id:'rule',name:'Day',locationId:'north',minStaff:1,maxStaff:1,generatorEnabled:true,appliesOn:{type:'date-range',startDate:'2026-10-01',endDate:'2026-10-01'}}];
    const employees=[{id:'a',name:'A',locationId:null},{id:'b',name:'B',locationId:null}];
    const availability=[{employeeId:'a',startDate:'2026-10-01',endDate:'2026-10-01'}];
    expect(generate(roster,null,rules,employees,availability,{seed:'same'}).shifts[0].assignments[0].employeeId).toBe('b');
    expect(monthDates(2026,2)).toHaveLength(28);
  });
  it('uses only the generated template for the roster location', () => {
    const roster={id:'r',locationId:'north',year:2026,month:10};
    const rules=[
      {id:'north',name:'North',locationId:'north',minStaff:1,maxStaff:1,generatorEnabled:true,appliesOn:{type:'date-range',startDate:'2026-10-01',endDate:'2026-10-01'}},
      {id:'south',name:'South',locationId:'south',minStaff:1,maxStaff:1,generatorEnabled:true,appliesOn:{type:'date-range',startDate:'2026-10-01',endDate:'2026-10-01'}}
    ];
    const employees=[{id:'north-employee',locationId:'north'},{id:'south-employee',locationId:'south'}];
    const shifts=generate(roster,null,rules,employees,[],{seed:'location'}).shifts;
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({ruleId:'north',locationId:'north'});
    expect(shifts[0].assignments[0].employeeId).toBe('north-employee');
  });
  it('persists records into the requested IndexedDB store', async () => {
    const location = await create('locations', { name: 'Test location' });
    expect((await get('locations', location.id)).name).toBe('Test location');
    await remove('locations', location.id);
  });
  it('fills concurrent shift capacity toward individual employee targets', () => {
    const roster={id:'r',locationId:'north',year:2026,month:10};
    const rules=[{id:'rule',name:'Day',locationId:'north',minStaff:1,maxStaff:2,generatorEnabled:true,appliesOn:{type:'weekdays',weekdays:[0,1,2,3,4,5,6]}}];
    const employees=[{id:'a',name:'A',locationId:null,targetDaysWorked:20},{id:'b',name:'B',locationId:null,targetDaysWorked:20}];
    const shifts=generate(roster,null,rules,employees,[],{seed:'same'}).shifts;
    expect(shifts.flatMap(s=>s.assignments).filter(a=>a.employeeId==='a')).toHaveLength(20);
    expect(shifts.flatMap(s=>s.assignments).filter(a=>a.employeeId==='b')).toHaveLength(20);
    expect(shifts.some(s=>s.assignments.length===2)).toBe(true);
  });
  it('uses the standard 20-day target for legacy employees without a saved target', () => {
    const roster={id:'r',locationId:'north',year:2026,month:10};
    const rules=[{id:'rule',name:'Day',locationId:'north',minStaff:1,maxStaff:2,generatorEnabled:true,appliesOn:{type:'weekdays',weekdays:[0,1,2,3,4,5,6]}}];
    const employees=[{id:'a',name:'A',locationId:null},{id:'b',name:'B',locationId:null}];
    const shifts=generate(roster,null,rules,employees,[],{seed:'legacy'}).shifts;
    expect(shifts.flatMap(s=>s.assignments).filter(a=>a.employeeId==='a')).toHaveLength(20);
    expect(shifts.flatMap(s=>s.assignments).filter(a=>a.employeeId==='b')).toHaveLength(20);
  });
  it('spreads target assignments while respecting the soft consecutive-days preference', () => {
    const roster={id:'r',locationId:'north',year:2026,month:10};
    const rules=[{id:'rule',name:'Day',locationId:'north',minStaff:0,maxStaff:1,generatorEnabled:true,appliesOn:{type:'weekdays',weekdays:[0,1,2,3,4,5,6]}}];
    const employees=[{id:'a',name:'A',locationId:null,targetDaysWorked:15,maxConsecutiveWorkDays:2}];
    const dates=generate(roster,null,rules,employees,[],{seed:'spread'}).shifts.filter(s=>s.assignments.length).map(s=>s.date);
    let longest=0, current=0, previous=''; for (const date of dates.sort()) { current = previous && Date.parse(`${date}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`) === 86400000 ? current+1 : 1; longest=Math.max(longest,current); previous=date; }
    expect(dates).toHaveLength(15); expect(longest).toBeLessThanOrEqual(2);
  });
  it('records deterministic soft-v2 optimization metadata and retains valid generated work on regeneration', () => {
    const roster={id:'r',locationId:'north',year:2026,month:10};
    const rules=[{id:'rule',name:'Day',locationId:'north',minStaff:1,maxStaff:1,generatorEnabled:true,appliesOn:{type:'date-range',startDate:'2026-10-01',endDate:'2026-10-02'}}];
    const employees=[{id:'a',locationId:null,targetDaysWorked:1},{id:'b',locationId:null,targetDaysWorked:1}];
    const first=generate(roster,null,rules,employees,[],{seed:'v2'});
    const next=generate(roster,first,rules,employees,[],{seed:'v2',fromDate:'2026-10-01',resetGenerated:true,preserveGeneratedAssignments:true});
    expect(next.generatorConfig.generatorVersion).toBe('soft-v2');
    expect(next.optimizationReport.final).toEqual(next.optimizationReport.baseline);
    expect(next.shifts.map(s=>s.assignments.map(a=>a.employeeId))).toEqual(first.shifts.map(s=>s.assignments.map(a=>a.employeeId)));
  });
  it('uses lexicographic quality: coverage outranks targets, then rest, then changes', () => {
    expect(compareQuality({coverageGaps:0,targetDeviation:10,consecutiveExcess:10,changes:10},{coverageGaps:1,targetDeviation:0,consecutiveExcess:0,changes:0})).toBeLessThan(0);
    expect(compareQuality({coverageGaps:0,targetDeviation:1,consecutiveExcess:10,changes:10},{coverageGaps:0,targetDeviation:2,consecutiveExcess:0,changes:0})).toBeLessThan(0);
    expect(compareQuality({coverageGaps:0,targetDeviation:1,consecutiveExcess:1,changes:0},{coverageGaps:0,targetDeviation:1,consecutiveExcess:1,changes:1})).toBeLessThan(0);
    const metrics=qualityMetrics([{id:'s',date:'2026-10-01',minStaff:2,assignments:[{id:'a',employeeId:'a',source:'generated',locked:false}]}],[{id:'a',targetDaysWorked:1,maxConsecutiveWorkDays:1}],new Set());
    expect(metrics.coverageGaps).toBe(1);
  });
  it('finishes infeasible schedules without violating hard assignment constraints', () => {
    const roster={id:'r',locationId:'north',year:2026,month:10};
    const rules=[{id:'rule',name:'Day',locationId:'north',minStaff:2,maxStaff:2,generatorEnabled:true,appliesOn:{type:'date-range',startDate:'2026-10-01',endDate:'2026-10-01'}}];
    const result=generate(roster,null,rules,[{id:'a',locationId:'north'}],[],{seed:'infeasible'});
    expect(result.shifts[0].assignments).toHaveLength(1);
    expect(result.coverageReport.unfilledSlots[0].missing).toBe(1);
    expect(result.optimizationReport.evaluations).toBeLessThanOrEqual(5001);
  });
});
