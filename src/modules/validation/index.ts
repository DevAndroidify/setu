// Public API of the validation module: entity schemas and business rules (pure).
export {
  compileRule,
  RULE_NAMES,
  todayInNepal,
  type Rule,
  type RuleContext,
  type RowValues,
} from './rules';
export {
  personSchema,
  rowSchema,
  PERSON_FIELDS,
  HOUSEHOLD_FIELDS,
  ROW_FIELDS,
  TARGET_FIELDS,
  type NormalizedPerson,
  type PersonField,
  type HouseholdField,
  type RowField,
} from './person.schema';
