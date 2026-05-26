export interface SecretHandleResolutionSuccess {
  readonly ok: true;
  readonly values: Readonly<Record<string, string>>;
}

export interface SecretHandleResolutionFailure {
  readonly ok: false;
  readonly error: SecretHandleResolutionError;
}

export type SecretHandleResolutionResult =
  | SecretHandleResolutionSuccess
  | SecretHandleResolutionFailure;

export interface SecretHandleResolver {
  resolve(
    handleNames: readonly string[],
  ): Promise<SecretHandleResolutionResult>;
}

export class SecretHandleResolutionError extends Error {
  readonly code = "secret_handles_missing";
  readonly missing_handles: readonly string[];

  constructor(missingHandles: readonly string[]) {
    const normalizedMissingHandles = deduplicateHandles(missingHandles);
    super(
      `Missing secret handle(s): ${normalizedMissingHandles.join(", ")}.`,
    );
    this.name = "SecretHandleResolutionError";
    this.missing_handles = Object.freeze([...normalizedMissingHandles]);
  }
}

export class StaticSecretHandleResolver implements SecretHandleResolver {
  readonly #values: ReadonlyMap<string, string>;

  constructor(values: Readonly<Record<string, string>>) {
    this.#values = new Map(Object.entries(values));
  }

  async resolve(
    handleNames: readonly string[],
  ): Promise<SecretHandleResolutionResult> {
    const requestedHandles = deduplicateHandles(handleNames);
    const missingHandles: string[] = [];
    const resolvedValues = Object.create(null) as Record<string, string>;

    for (const handleName of requestedHandles) {
      if (!this.#values.has(handleName)) {
        missingHandles.push(handleName);
        continue;
      }

      const resolvedValue = this.#values.get(handleName);

      if (resolvedValue === undefined) {
        missingHandles.push(handleName);
        continue;
      }

      Object.defineProperty(resolvedValues, handleName, {
        value: resolvedValue,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }

    if (missingHandles.length > 0) {
      return {
        ok: false,
        error: new SecretHandleResolutionError(missingHandles),
      };
    }

    return {
      ok: true,
      values: Object.freeze(resolvedValues),
    };
  }
}

function deduplicateHandles(handleNames: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(handleNames)]);
}