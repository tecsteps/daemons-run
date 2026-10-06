export class DurableObject<E = unknown> {
  constructor(
    readonly ctx: unknown,
    readonly env: E,
  ) {}
}
export class WorkerEntrypoint<E = unknown> {
  env!: E;
}
