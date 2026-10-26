export function parsePort(value: string | undefined): number {
  if (value === undefined) return 4410;
  if (!/^[0-9]{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535)
    throw new Error("PORT must be a whole number between 1 and 65535.");
  return Number(value);
}
