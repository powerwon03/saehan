// Pure display formatting for the admin screens. Seoul time by fixed +09:00 arithmetic (no Intl time zones).

const KST_MS = 9 * 3_600_000;

/** ISO instant → Seoul 'MM/DD HH:mm'. Invalid input → ''. */
export function seoulDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const s = new Date(ms + KST_MS).toISOString(); // YYYY-MM-DDTHH:mm…
  return `${s.slice(5, 7)}/${s.slice(8, 10)} ${s.slice(11, 16)}`;
}
