import { z } from 'zod';
import { DEFAULT_BS_FORMATS, TRANSFORMS } from '../transforms';
import { RULE_NAMES, TARGET_FIELDS } from '../validation';
import { REQUIRED_TARGETS } from './mapping-spec';

/** What follows the colon in a rule ("after:1940-01-01"), if anything. */
export const RULE_PARAMS: Record<string, 'date' | 'number' | null> = {
  required: null,
  notFuture: null,
  after: 'date',
  citizenshipFormat: null,
  maxLength: 'number',
  max: 'number',
  wardInUnit: null,
};

/**
 * Everything a mapping spec may name, read from the same registries the backend validates
 * with, so an editor never offers what a save would refuse. Transform arguments are given as
 * JSON Schema.
 */
export function mappingCatalog() {
  return {
    targets: Object.keys(TARGET_FIELDS),
    requiredTargets: REQUIRED_TARGETS,
    transforms: Object.entries(TRANSFORMS).map(([name, definition]) => ({
      name,
      args: z.toJSONSchema(definition.args, { io: 'input', unrepresentable: 'any' }),
    })),
    rules: RULE_NAMES.map((name) => ({ name, param: RULE_PARAMS[name] ?? null })),
    bsDateFormats: DEFAULT_BS_FORMATS,
    onError: ['quarantine', 'null'],
  };
}
