// Public API of the validation module: entity schemas and business rules (pure).
export { compileRule, RULE_NAMES, todayInNepal, type Rule, type RuleContext } from './rules';
export {
  personSchema,
  PERSON_FIELDS,
  type NormalizedPerson,
  type PersonField,
} from './person.schema';
