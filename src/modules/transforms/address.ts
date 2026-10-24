import { fail, ok, TransformResult } from './transform-result';

/**
 * Reference data the address transforms and rules need, passed in so they stay pure: the
 * VDC-to-local-unit crosswalk and each local unit's ward count.
 */
export type AddressReference = {
  /** Normalized "district vdc" -> local unit code, or null when the VDC needs review. */
  vdcs: ReadonlyMap<string, string | null>;
  wardCounts: ReadonlyMap<string, number>;
  /** Local unit code -> district code, for blocking duplicates by district. */
  districts: ReadonlyMap<string, string>;
};

export const EMPTY_ADDRESS_REFERENCE: AddressReference = {
  vdcs: new Map(),
  wardCounts: new Map(),
  districts: new Map(),
};

/** Lower-cases, collapses spaces and drops the "VDC" / "V.D.C." / "Gabisa" suffix clerks add. */
export function placeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/,/g, ' ')
    .replace(/\s+(vdc|gabisa|ga\s*bi\s*sa)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildAddressReference(
  units: { code: string; wardCount: number; districtCode: string }[],
  vdcs: { districtCode: string; nameEn: string; localUnitCode: string | null }[],
): AddressReference {
  return {
    vdcs: new Map(vdcs.map((v) => [placeKey(`${v.districtCode} ${v.nameEn}`), v.localUnitCode])),
    wardCounts: new Map(units.map((u) => [u.code, u.wardCount])),
    districts: new Map(units.map((u) => [u.code, u.districtCode])),
  };
}

/**
 * Maps an old VDC address ("district vdc", as the mapping joins the two columns) to the local
 * unit that replaced it in 2017. A VDC split across several units cannot be decided from the
 * name alone, so it fails with a reason that sends the row to review.
 */
export function vdcToLocalUnit(input: string, ref: AddressReference): TransformResult<string> {
  const key = placeKey(input);
  if (key === '') return ok('');
  const code = ref.vdcs.get(key);
  if (code === undefined) return fail(`"${input.trim()}" is not a VDC in the crosswalk`);
  if (code === null) {
    return fail(
      `needs review: "${input.trim()}" was split across several local units; choose the unit by hand`,
    );
  }
  return ok(code);
}
