// v1.110.0 — reads and writes the bookings kept in the settings document. The rules are in liveFloor.ts.
import { genId, getCurrentUser, getSettings, saveSettings } from '@/lib/store';
import type { FloorFixture, TableReservation } from '@/lib/types';
import { bookingProblem, type BookingInput } from '@/lib/liveFloor';
import type { DiningTable } from '@/lib/types';

export const getReservations = (): TableReservation[] => getSettings().tableReservations || [];

function write(next: TableReservation[]) {
  // the booking list only keeps what still matters: booked ones and the last 2 days of anything else
  const cutoff = Date.now() - 2 * 86400000;
  saveSettings({ ...getSettings(), tableReservations: next.filter(r => r.status === 'booked' || new Date(r.at).getTime() >= cutoff) });
}

export function addReservation(input: BookingInput, table: DiningTable | undefined): { ok: true; reservation: TableReservation } | { ok: false; reason: string } {
  const reason = bookingProblem(input, table, getReservations(), Date.now());
  if (reason) return { ok: false, reason };
  const r: TableReservation = {
    id: genId(), tableId: input.tableId, name: input.name.trim(), phone: input.phone?.trim() || undefined,
    guests: Math.floor(input.guests), at: new Date(input.at).toISOString(), note: input.note?.trim() || undefined,
    status: 'booked', createdAt: new Date().toISOString(), createdBy: getCurrentUser()?.name,
  };
  write([...getReservations(), r]);
  return { ok: true, reservation: r };
}

export function setReservationStatus(id: string, status: TableReservation['status']) {
  write(getReservations().map(r => (r.id === id ? { ...r, status } : r)));
}

export const getFixtures = (): FloorFixture[] => getSettings().floorFixtures || [];
export const saveFixtures = (next: FloorFixture[]) => saveSettings({ ...getSettings(), floorFixtures: next });
