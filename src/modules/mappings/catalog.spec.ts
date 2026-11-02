import { RULE_NAMES } from '../validation';
import { mappingCatalog, RULE_PARAMS } from './catalog';

describe('mappingCatalog', () => {
  const catalog = mappingCatalog();

  it('describes every rule the validator knows, with the kind of parameter it takes', () => {
    expect(Object.keys(RULE_PARAMS).sort()).toEqual([...RULE_NAMES].sort());
    expect(catalog.rules).toContainEqual({ name: 'after', param: 'date' });
    expect(catalog.rules).toContainEqual({ name: 'required', param: null });
  });

  it('lists person and household targets, marking the required ones', () => {
    expect(catalog.targets).toEqual(expect.arrayContaining(['person.dob_ad', 'household.ward_no']));
    expect(catalog.requiredTargets).toEqual(['person.name_ne', 'person.name_en']);
  });

  it('gives each transform the JSON Schema of its arguments', () => {
    const byName = Object.fromEntries(catalog.transforms.map((t) => [t.name, t.args]));
    expect(Object.keys(byName)).toEqual(
      expect.arrayContaining(['preetiToUnicode', 'bsToAd', 'mapValues', 'vdcToLocalUnit']),
    );
    expect(byName.namePart).toMatchObject({
      type: 'object',
      properties: { part: { enum: ['first', 'middle', 'last'] } },
    });
    expect(byName.mapValues).toMatchObject({ required: ['values'] });
  });
});
