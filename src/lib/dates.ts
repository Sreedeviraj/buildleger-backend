// Calendar days ('YYYY-MM-DD') are stored in @db.Date columns as UTC midnight,
// so no time zone can move a payment to the day before.

export function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function fromDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's date in India, whatever time zone the server runs in. */
export function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
