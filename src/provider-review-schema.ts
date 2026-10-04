import { reviewSchema, type Contract, type Evidence } from './domain';
/** Generation constraints reduce malformed IDs; local validation still proves support. */
export function providerReviewSchema(
  contract: Pick<Contract, 'requirements'>,
  evidence: Evidence[],
) {
  const schema = structuredClone(reviewSchema.toJSONSchema()) as Record<
    string,
    any
  >;
  const ids = [...new Set(evidence.map((e) => e.id))];
  const criteria = contract.requirements.flatMap((r) =>
    r.criteria.map((c) => c.id),
  );
  function visit(node: any) {
    if (!node || typeof node !== 'object') return;
    for (const [name, definition] of Object.entries(node.properties ?? {}) as [
      string,
      any,
    ][]) {
      if (
        (name === 'evidenceIds' || name === 'evidence') &&
        definition.type === 'array'
      )
        definition.items = { $ref: '#/$defs/evidenceId' };
      if (name === 'criterionId') Object.assign(definition, { enum: criteria });
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  }
  visit(schema);
  schema.$defs = {
    ...(schema.$defs ?? {}),
    evidenceId: ids.length
      ? { type: 'string', enum: ids }
      : { type: 'string', not: {} },
  };
  schema.properties.assessments.minItems = criteria.length;
  schema.properties.assessments.maxItems = criteria.length;
  return schema;
}
