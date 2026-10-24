import reference from '../../../prisma/reference/address.json';
import known from '../../../test/fixtures/address/known-vdcs.json';
import { buildAddressReference, placeKey, vdcToLocalUnit } from './address';

const ref = buildAddressReference(reference.localUnits, reference.legacyVdcs);

describe('vdcToLocalUnit', () => {
  it.each(known.cases.filter((c) => c.localUnit !== null))(
    'maps "$input" to $localUnit',
    ({ input, localUnit }) => {
      expect(vdcToLocalUnit(input, ref)).toEqual({ ok: true, value: localUnit, warnings: [] });
    },
  );

  it.each(known.cases.filter((c) => c.localUnit === null))(
    'sends "$input", a VDC split across units, to review',
    ({ input }) => {
      const result = vdcToLocalUnit(input, ref);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatch(/^needs review: .* split across several/);
    },
  );

  it('fails on a VDC that is not in the crosswalk instead of guessing', () => {
    expect(vdcToLocalUnit('Kaski Atlantis', ref)).toEqual({
      ok: false,
      error: '"Kaski Atlantis" is not a VDC in the crosswalk',
    });
  });

  it('does not match a VDC name in the wrong district', () => {
    expect(vdcToLocalUnit('Chitwan Hemja', ref).ok).toBe(false);
  });

  it('passes a blank address through for the required rule to judge', () => {
    expect(vdcToLocalUnit('  ', ref)).toEqual({ ok: true, value: '', warnings: [] });
  });

  it('knows the ward count of every local unit the crosswalk points to', () => {
    for (const code of ref.vdcs.values()) {
      if (code !== null) expect(ref.wardCounts.get(code)).toBeGreaterThan(0);
    }
  });
});

describe('placeKey', () => {
  it('ignores case, spacing and the VDC or Gabisa suffix', () => {
    expect(placeKey('  KASKI   Hemja  Gabisa ')).toBe('kaski hemja');
    expect(placeKey('Kaski Hemja V.D.C.')).toBe('kaski hemja');
  });
});
