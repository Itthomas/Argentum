import { describe, expect, it } from "vitest";

import {
  SecretHandleResolutionError,
  StaticSecretHandleResolver,
  type SecretHandleResolver,
} from "../src/index.js";

describe("StaticSecretHandleResolver", () => {
  it("resolves known handle names to their injected values", async () => {
    const resolver: SecretHandleResolver = new StaticSecretHandleResolver({
      GITHUB_TOKEN: "ghp_test_token",
      OPENAI_API_KEY: "sk-test-key",
    });

    const result = await resolver.resolve(["GITHUB_TOKEN"]);

    expect(result).toEqual({
      ok: true,
      values: {
        GITHUB_TOKEN: "ghp_test_token",
      },
    });
  });

  it("reports missing handle names deterministically without exposing secret values", async () => {
    const resolver = new StaticSecretHandleResolver({
      PRESENT_HANDLE: "present-secret-value",
      OTHER_PRESENT_HANDLE: "other-secret-value",
    });

    const result = await resolver.resolve([
      "MISSING_B",
      "PRESENT_HANDLE",
      "MISSING_A",
      "MISSING_B",
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected missing-handle resolution to fail.");
    }

    expect(result.error).toBeInstanceOf(SecretHandleResolutionError);
    expect(result.error.code).toBe("secret_handles_missing");
    expect(result.error.missing_handles).toEqual(["MISSING_B", "MISSING_A"]);
    expect(result.error.message).toBe(
      "Missing secret handle(s): MISSING_B, MISSING_A.",
    );
    expect(result.error.message).not.toContain("present-secret-value");
    expect(result.error.message).not.toContain("other-secret-value");
    expect("values" in result).toBe(false);
  });

  it("returns identical resolved maps for repeated calls with the same handles", async () => {
    const resolver = new StaticSecretHandleResolver({
      SECRET_A: "value-a",
      SECRET_B: "value-b",
    });

    const first = await resolver.resolve(["SECRET_B", "SECRET_A"]);
    const second = await resolver.resolve(["SECRET_B", "SECRET_A"]);

    expect(first).toEqual({
      ok: true,
      values: {
        SECRET_B: "value-b",
        SECRET_A: "value-a",
      },
    });
    expect(second).toEqual(first);
  });

  it("resolves prototype-named handles only when they are explicitly injected", async () => {
    const resolver = new StaticSecretHandleResolver({
      toString: "prototype-safe-secret",
    });

    const result = await resolver.resolve(["toString", "valueOf"]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unresolved prototype-named handle to fail.");
    }

    expect(result.error.missing_handles).toEqual(["valueOf"]);
    expect(result.error.message).not.toContain("prototype-safe-secret");
  });

  it("round-trips __proto__ when it is injected as a canonical handle name", async () => {
    const injectedValues = Object.create(null) as Record<string, string>;
    Object.defineProperty(injectedValues, "__proto__", {
      value: "proto-safe-secret",
      enumerable: true,
      configurable: true,
      writable: true,
    });

    const resolver = new StaticSecretHandleResolver(injectedValues);

    const result = await resolver.resolve(["__proto__"]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected __proto__ handle resolution to succeed.");
    }

    expect(Object.isFrozen(result.values)).toBe(true);
    expect(Object.getPrototypeOf(result.values)).toBeNull();
    expect(Object.hasOwn(result.values, "__proto__")).toBe(true);
    expect(result.values.__proto__).toBe("proto-safe-secret");
    expect(Object.getOwnPropertyDescriptor(result.values, "__proto__")).toMatchObject({
      enumerable: true,
      value: "proto-safe-secret",
    });
  });

  it("does not retain a mutable reference to the injected backing map", async () => {
    const backingValues = {
      STABLE_HANDLE: "stable-secret",
    };

    const resolver = new StaticSecretHandleResolver(backingValues);

    backingValues.STABLE_HANDLE = "mutated-secret";
    Object.assign(backingValues, {
      LATE_HANDLE: "late-secret",
    });

    const result = await resolver.resolve(["STABLE_HANDLE", "LATE_HANDLE"]);

    expect(backingValues).toEqual({
      STABLE_HANDLE: "mutated-secret",
      LATE_HANDLE: "late-secret",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected late-added handle to remain unavailable.");
    }
    expect(result.error.missing_handles).toEqual(["LATE_HANDLE"]);
    expect(result.error.message).not.toContain("stable-secret");
    expect(result.error.message).not.toContain("mutated-secret");
  });

  it("returns frozen resolved values so downstream callers cannot mutate the result", async () => {
    const resolver = new StaticSecretHandleResolver({
      IMMUTABLE_HANDLE: "immutable-secret",
    });

    const result = await resolver.resolve(["IMMUTABLE_HANDLE"]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected handle resolution to succeed.");
    }

    expect(Object.isFrozen(result.values)).toBe(true);
  });
});