const VISIBLE = 5;

/**
 * Masks a citizenship number down to its last five characters, keeping the dashes so the
 * reader still recognises the shape: 27-01-71-12345 -> **-**-**-12345.
 */
export function maskCitizenshipNo(value: string | null): string | null {
  if (value === null) return null;
  const cut = Math.max(0, value.length - VISIBLE);
  const hidden = value.slice(0, cut).replace(/[^-]/g, '*');
  return value.length <= VISIBLE ? '*'.repeat(value.length) : hidden + value.slice(cut);
}
