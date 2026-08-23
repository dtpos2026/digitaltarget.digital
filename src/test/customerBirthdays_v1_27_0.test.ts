// ============================================================================
// v1.27.0 — birthdays are a CRM feature, not an app feature
//
// The customer app collects the date; the value is the restaurant being able to
// find who to send an offer to. These assert the arithmetic, including the two
// cases that are easy to get wrong and impossible to notice in testing: a
// birthday that has already passed this year, and 29 February.
// ============================================================================
import { describe, it, expect } from 'vitest';
import {
  daysUntilBirthday, isBirthdayToday, ageOnNextBirthday, birthdaysWithin,
} from '@/lib/customers';

const on = (iso: string) => new Date(iso + 'T12:00:00');

describe('daysUntilBirthday', () => {
  it('is 0 on the day itself', () => {
    expect(daysUntilBirthday('1994-03-17', on('2026-03-17'))).toBe(0);
    expect(isBirthdayToday('1994-03-17', on('2026-03-17'))).toBe(true);
  });

  it('counts forward within the year', () => {
    expect(daysUntilBirthday('1994-03-20', on('2026-03-17'))).toBe(3);
  });

  it('rolls into next year once the date has passed', () => {
    // The naive version returns a negative number here and the customer
    // silently drops off every birthday list for the rest of the year.
    expect(daysUntilBirthday('1994-03-01', on('2026-03-17'))).toBe(349);
  });

  it('marks 29 February on 1 March in a common year', () => {
    expect(daysUntilBirthday('2000-02-29', on('2026-03-01'))).toBe(0);
    // 2028 is a leap year, so the real date exists.
    expect(daysUntilBirthday('2000-02-29', on('2028-02-29'))).toBe(0);
  });

  it('is null when there is no date, or the date is nonsense', () => {
    expect(daysUntilBirthday(undefined)).toBeNull();
    expect(daysUntilBirthday('')).toBeNull();
    expect(daysUntilBirthday('not-a-date')).toBeNull();
  });
});

describe('ageOnNextBirthday', () => {
  it('gives the age they are turning', () => {
    expect(ageOnNextBirthday('1994-03-20', on('2026-03-17'))).toBe(32);
  });
  it('refuses an implausible year rather than showing it', () => {
    expect(ageOnNextBirthday('1650-03-20', on('2026-03-17'))).toBeNull();
  });
});

describe('birthdaysWithin', () => {
  const customers = [
    { id: 'a', name: 'Today',    dateOfBirth: '1990-03-17' },
    { id: 'b', name: 'In three', dateOfBirth: '1985-03-20' },
    { id: 'c', name: 'Next month', dateOfBirth: '1988-04-20' },
    { id: 'd', name: 'No date' },
  ];

  it('finds this week, soonest first, and skips customers with no date', () => {
    const week = birthdaysWithin(customers, 7, on('2026-03-17'));
    expect(week.map(b => b.customer.name)).toEqual(['Today', 'In three']);
    expect(week[0].daysUntil).toBe(0);
    expect(week[1].daysUntil).toBe(3);
  });

  it('days=0 is the campaign you actually send today', () => {
    const today = birthdaysWithin(customers, 0, on('2026-03-17'));
    expect(today.map(b => b.customer.name)).toEqual(['Today']);
  });

  it('carries the age so a message can use it', () => {
    const [first] = birthdaysWithin(customers, 7, on('2026-03-17'));
    expect(first.age).toBe(36);
  });
});
