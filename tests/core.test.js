import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { availabilityImportMutations, parseAvailabilityText, isUnavailable } from '../src/core/availability.js';
import { monthDates, normalizedName } from '../src/core/utils.js';
import { generate } from '../src/core/generator.js';
import { compareQuality, qualityMetrics } from '../src/core/quality.js';
import { create, get, remove } from '../src/db/index.js';
import { deleteEmployee } from '../src/core/versions.js';

describe('calendar and availability', () => {
  it('normalizes names and validates availability input', () => {
    expect(normalizedName(' Ada   Lovelace ')).toBe('ada lovelace');
    expect(parseAvailabilityText('\uFEFF{"employee_name":"Ada","selected_dates":["2026-10-03"]}').dates).toEqual(['2026-10-03']);
    expect(() => parseAvailabilityText('{"employee_name":"Ada","selected_dates":["bad"]}')).toThrow();
    expect(() => parseAvailabilityText('{"employee_name":"Ada","selected_dates":["2026-10-03","2026-11-01"]}')).toThrow('same month');
    expect(isUnavailable([{employeeId:'a',startDate:'2026-10-01',endDate:'2026-10-03'}],'a','2026-10-02')).toBe(true);
  });
  it('treats imported selected dates as available and makes every other day in that month unavailable', () => {
    const preview = { ...parseAvailabilityText('{"employee_name":"Ada","selected_dates":["2026-10-03","2026-10-14"]}'), datesToAdd: monthDates(2026, 10).filter(date => !['2026-10-03', '2026-10-14'].includes(date)) };
    const mutations = availabilityImportMutations(preview, 'a', [{ id: 'old', employeeId: 'a', startDate: '2026-09-29', endDate: '2026-10-05', source: 'manual' }]);
    const resulting = [...mutations.replacements, ...mutations.additions];
    expect(mutations.removeIds).toEqual(['old']);
    expect(isUnavailable(resulting, 'a', '2026-10-03')).toBe(false);
    expect(isUnavailable(resulting, 'a', '2026-10-14')).toBe(false);
    expect(isUnavailable(resulting, 'a', '2026-10-01')).toBe(true);
    expect(isUnavailable(resulting, 'a', '2026-10-31')).toBe(true);
    expect(isUnavailable(resulting, 'a', '2026-09-30')).toBe(true);
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
  it('removes a deleted employee from every retained roster assignment', async () => {
    const employee = await create('employees', { name: 'Deleted employee' });
    const version = await create('rosterVersions', {
      rosterId: 'cleanup-roster',
      shifts: [{ id: 'cleanup-shift', name: 'Day', locationId: null, date: '2026-10-01', minStaff: 1, maxStaff: 1, assignments: [{ id: 'cleanup-assignment', employeeId: employee.id }] }]
    });
    expect(await deleteEmployee(employee.id)).toBe(1);
    const cleaned = await get('rosterVersions', version.id);
    expect(cleaned.shifts[0].assignments).toEqual([]);
    expect(cleaned.coverageReport.conflicts).not.toContainEqual(expect.objectContaining({ message: 'Assignment employee no longer exists.' }));
    await remove('rosterVersions', version.id);
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
  it('keeps manual shifts occupied without counting them toward generated targets', () => {
    const roster={id:'r',locationId:'north',year:2026,month:10};
    const rules=[{id:'generated',name:'Generated',locationId:'north',minStaff:0,maxStaff:1,generatorEnabled:true,appliesOn:{type:'date-range',startDate:'2026-10-01',endDate:'2026-10-02'}}];
    const employees=[{id:'a',name:'A',locationId:'north',targetDaysWorked:1}];
    const prior={id:'proposal',shifts:[{id:'manual',ruleId:'other',name:'Other',locationId:'north',date:'2026-10-01',manual:true,minStaff:1,maxStaff:1,assignments:[{id:'manual-assignment',employeeId:'a',source:'manual',locked:true}]}]};
    const result=generate(roster,prior,rules,employees,[],{seed:'manual-shift',resetGenerated:true});
    const generated=result.shifts.find(shift=>!shift.manual && shift.assignments.length);
    expect(generated.assignments.map(assignment=>assignment.employeeId)).toEqual(['a']);
    expect(generated.date).toBe('2026-10-02');
    expect(result.coverageReport.targetDeviation.a).toBe(0);
  });
  it('spreads target assignments while respecting the soft consecutive-days preference', () => {
    const roster={id:'r',locationId:'north',year:2026,month:10};
    const rules=[{id:'rule',name:'Day',locationId:'north',minStaff:0,maxStaff:1,generatorEnabled:true,appliesOn:{type:'weekdays',weekdays:[0,1,2,3,4,5,6]}}];
    const employees=[{id:'a',name:'A',locationId:null,targetDaysWorked:15,maxConsecutiveWorkDays:2}];
    const dates=generate(roster,null,rules,employees,[],{seed:'spread'}).shifts.filter(s=>s.assignments.length).map(s=>s.date);
    let longest=0, current=0, previous=''; for (const date of dates.sort()) { current = previous && Date.parse(`${date}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`) === 86400000 ? current+1 : 1; longest=Math.max(longest,current); previous=date; }
    expect(dates).toHaveLength(15); expect(longest).toBeLessThanOrEqual(2);
  });
  it('spreads optional target assignments across days instead of filling the first day', () => {
    const roster={id:'r',locationId:'north',year:2026,month:10};
    const rules=[{id:'rule',name:'Day',locationId:'north',minStaff:0,maxStaff:4,generatorEnabled:true,appliesOn:{type:'weekdays',weekdays:[0,1,2,3,4,5,6]}}];
    const employees=['a','b','c','d'].map(id=>({id,locationId:null,targetDaysWorked:1}));
    const assigned=generate(roster,null,rules,employees,[],{seed:'day-spread'}).shifts.filter(shift=>shift.assignments.length);
    expect(assigned).toHaveLength(4);
    expect(assigned.every(shift=>shift.assignments.length === 1)).toBe(true);
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
