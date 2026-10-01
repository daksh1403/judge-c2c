// Test-only platform adapter: never creates a VM or executes repository code.
export class DurableObject<T> {
  constructor(
    protected ctx: DurableObjectState,
    protected env: T,
  ) {}
}
export class WorkflowEntrypoint<T> {
  constructor(
    protected ctx: ExecutionContext,
    protected env: T,
  ) {}
}
