// Public API of the transforms module: pure functions, no I/O.
export * from './transform-result';
export { devanagariDigits } from './digits';
export { trim, splitName, titleCase, namePart, type NameParts } from './text';
export { mapValues } from './values';
export {
  bsToAd,
  adToBs,
  fiscalYear,
  DEFAULT_BS_FORMATS,
  BS_MIN_YEAR,
  BS_MAX_YEAR,
} from './bs-date';
export { preetiToUnicode } from './preeti';
export {
  buildAddressReference,
  EMPTY_ADDRESS_REFERENCE,
  placeKey,
  vdcToLocalUnit,
  type AddressReference,
} from './address';
export {
  TRANSFORMS,
  compileStep,
  runChain,
  type CompiledStep,
  type TransformName,
  type TransformStep,
} from './registry';
