// Public API of the mappings module.
export { MappingsModule } from './mappings.module';
export { MappingsService } from './mappings.service';
export {
  compileMapping,
  mapRow,
  transformRow,
  validateRow,
  type TransformedRow,
  type CompiledMapping,
  type FieldIssue,
  type MappedRow,
  type NormalizedRow,
} from './mapping-engine';
export { mappingSpecSchema, type MappingSpec } from './mapping-spec';
