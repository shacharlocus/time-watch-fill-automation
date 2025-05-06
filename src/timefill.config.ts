export interface DateRange { start: string; end: string; }

/** mark these as vacation (only Mon–Fri will be used) */
export const VACATIONS: DateRange[] = [
//   { start: '2025-05-08', end: '2025-05-30' }
];

/** mark these as sick days (same weekday filtering) */
export const SICK_DAYS: DateRange[] = [
  // { start: '2025-06-05', end: '2025-06-07' },
];