// ── MVP Schema Validator ────────────────────────────────────────
// Supports: type, properties, required, additionalProperties.
// Empty schema {} passes all inputs.
// Returns structured error messages with property paths.

export interface SchemaValidationResult {
  readonly valid: true;
}

export interface SchemaValidationFailure {
  readonly valid: false;
  readonly errors: string[];
}

export type SchemaValidationOutcome = SchemaValidationResult | SchemaValidationFailure;

type UnknownRecord = Record<string, unknown>;

/**
 * Validate `args` against a JSON Schema-like `input_schema` supporting
 * the MVP subset: `type: "object"`, `properties`, `required`, `additionalProperties`.
 * An empty schema (`{}`) passes all inputs.
 */
export function validateAgainstSchema(
  args: UnknownRecord,
  schema: UnknownRecord,
): SchemaValidationOutcome {
  const errors: string[] = [];

  // Empty schema means no constraints — all inputs pass.
  if (Object.keys(schema).length === 0) {
    return { valid: true };
  }

  // Guard: if schema has constraints (properties, required, etc.) but the
  // input is not an object, reject early.  Without this guard, the `in`
  // operator in property validation would throw TypeError on null/primitive.
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    errors.push(`arguments must be an object, got ${typeof args}`);
    return { valid: false, errors };
  }

  const schemaType = schema["type"];
  if (schemaType !== undefined) {
    if (schemaType !== "object") {
      errors.push(`schema "type" must be "object", got ${String(schemaType)}`);
      return { valid: false, errors };
    }

    // args must be a plain object (it already is by type, but double-check)
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      errors.push(`expected object, got ${typeof args}`);
      return { valid: false, errors };
    }
  }

  // Validate required properties
  const required = schema["required"];
  if (required !== undefined && !Array.isArray(required)) {
    errors.push(`schema "required" must be an array, got ${typeof required}`);
    return { valid: false, errors };
  }
  if (Array.isArray(required)) {
    for (const prop of required) {
      if (typeof prop !== "string") {
        errors.push(`required array contains non-string entry: ${String(prop)}`);
        continue;
      }
      if (!(prop in args)) {
        errors.push(`missing required property: "${prop}"`);
      }
    }
  }

  // Validate property types
  const properties = schema["properties"];
  if (properties !== undefined && typeof properties === "object" && properties !== null) {
    const propsRecord = properties as UnknownRecord;
    for (const [propName, propSchema] of Object.entries(propsRecord)) {
      // Only validate if the property is present in args
      if (!(propName in args)) {
        continue;
      }

      const propValue = args[propName];
      const propType = (propSchema as UnknownRecord)?.["type"];

      if (propType !== undefined) {
        const matched = valueMatchesType(propValue, propType as string);
        if (!matched) {
          errors.push(
            `property "${propName}" expected type "${String(propType)}", got type "${typeof propValue}"`,
          );
        }
      }

      // Recurse into nested object schemas
      if (
        propValue !== null &&
        typeof propValue === "object" &&
        !Array.isArray(propValue) &&
        typeof propSchema === "object" &&
        propSchema !== null &&
        (propSchema as UnknownRecord)["type"] === "object"
      ) {
        const nested = validateAgainstSchema(
          propValue as UnknownRecord,
          propSchema as UnknownRecord,
        );
        if (!nested.valid) {
          for (const nestedError of nested.errors) {
            errors.push(`${propName}.${nestedError}`);
          }
        }
      }
    }
  }

  // Validate additionalProperties
  const additionalProperties = schema["additionalProperties"];
  if (additionalProperties === false && properties !== undefined) {
    const knownProps = new Set(Object.keys(properties as UnknownRecord));
    for (const key of Object.keys(args)) {
      if (!knownProps.has(key)) {
        errors.push(`unknown property: "${key}" (additionalProperties is false)`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

function valueMatchesType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      // Unknown types — be permissive for forward compat
      return true;
  }
}
