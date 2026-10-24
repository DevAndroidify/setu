// Public API of the matching module: pure scoring plus the candidate store.
export { jaroWinkler } from './jaro-winkler';
export { transliterate } from './transliterate';
export {
  AUTO_LINK,
  REVIEW,
  bestMatch,
  blockKey,
  compare,
  comparePrepared,
  prepare,
  type PreparedRecord,
  type MatchFeatures,
  type MatchRecord,
  type MatchResult,
} from './score';
export {
  matchBatch,
  type MatchCandidateInput,
  type MatchInput,
  type MatchOutcome,
} from './match-batch';
export { MatchingModule } from './matching.module';
export { MatchingService } from './matching.service';
