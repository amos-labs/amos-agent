export const ORGANISM_CONTRACT_VERSION = 1;
export const STRATEGY_GENE_PROCEDURE_SCHEMA = "amos.strategy-gene-procedure";
export const STRATEGY_GENE_CANDIDATE_SCHEMA = "amos.strategy-gene-candidate";
export const GENE_EXPRESSION_SCHEMA = "amos.gene-expression";
export const ORGANISM_TRACE_BUNDLE_SCHEMA = "amos.organism-trace-bundle";

export function assertCanonicalProcedure(value) {
  if (
    !value
    || value.schema !== STRATEGY_GENE_PROCEDURE_SCHEMA
    || value.schemaVersion !== ORGANISM_CONTRACT_VERSION
    || !value.spec
    || !Array.isArray(value.parentIds)
    || !Array.isArray(value.evidenceRefs)
  ) {
    throw new Error("Invalid canonical organism strategy-gene procedure");
  }
  return value;
}
