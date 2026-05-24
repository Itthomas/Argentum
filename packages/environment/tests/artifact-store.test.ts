import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseContentRef } from "@argentum/contracts";
import type { ContentRef, ContentRefKind } from "@argentum/contracts";

import {
  ARTIFACT_FILE_EXTENSIONS,
  CALL_ID_PATTERN,
  storeToolArtifact,
} from "../src/index.js";

// ── Helpers ─────────────────────────────────────────────────────

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "argentum-artifact-test-"));
}

async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Returns all files recursively under a directory (relative paths). */
async function listAllFiles(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        results.push(full);
      }
    }
  }

  await walk(dir);
  return results;
}

// ── Tests ───────────────────────────────────────────────────────

describe("storeToolArtifact", () => {
  it("stores with default kind=text and returns a valid ContentRef", async () => {
    const artifactsRoot = await tempDir();
    try {
      const callId = "call-001";
      const content = "hello world";

      const ref = await storeToolArtifact(callId, content, artifactsRoot);

      // ContentRef shape
      expect(ref.ref_id).toBeTypeOf("string");
      expect(ref.ref_id.length).toBeGreaterThan(0);
      expect(ref.kind).toBe("text");
      expect(ref.storage_area).toBe("artifacts");
      expect(ref.locator).toBe("call-001.txt");
      expect(ref.media_type).toBe("text/plain");
      expect(ref.retention).toBe("session");

      // File exists on disk
      const filePath = path.join(artifactsRoot, ref.locator);
      const written = await readFile(filePath, "utf-8");
      expect(written).toBe(content);
    } finally {
      await removeDir(artifactsRoot);
    }
  });

  it("stores with explicit kind=json and correct extension", async () => {
    const artifactsRoot = await tempDir();
    try {
      const callId = "call-002";
      const content = '{"ok":true}';

      const ref = await storeToolArtifact(callId, content, artifactsRoot, "json");

      expect(ref.kind).toBe("json");
      expect(ref.locator).toBe("call-002.json");
      expect(ref.media_type).toBe("application/json");

      const filePath = path.join(artifactsRoot, ref.locator);
      const written = await readFile(filePath, "utf-8");
      expect(written).toBe(content);
    } finally {
      await removeDir(artifactsRoot);
    }
  });

  it.each([
    { kind: "text" as ContentRefKind, ext: ".txt" },
    { kind: "json" as ContentRefKind, ext: ".json" },
    { kind: "trace" as ContentRefKind, ext: ".log" },
    { kind: "file" as ContentRefKind, ext: ".bin" },
    { kind: "blob" as ContentRefKind, ext: ".blob" },
  ])("uses correct extension for kind=$kind → $ext", async ({ kind, ext }) => {
    const artifactsRoot = await tempDir();
    try {
      const ref = await storeToolArtifact("call-ext", "data", artifactsRoot, kind);
      expect(ref.locator).toBe(`call-ext${ext}`);
      expect(ARTIFACT_FILE_EXTENSIONS[kind]).toBe(ext);
    } finally {
      await removeDir(artifactsRoot);
    }
  });

  it("rejects callId with path traversal characters", async () => {
    const artifactsRoot = await tempDir();
    try {
      await expect(
        storeToolArtifact("../../../etc/passwd", "evil", artifactsRoot),
      ).rejects.toThrow(/callId.*invalid/i);
    } finally {
      await removeDir(artifactsRoot);
    }
  });

  it("rejects callId with invalid characters", async () => {
    const artifactsRoot = await tempDir();
    try {
      // Contains a space
      await expect(
        storeToolArtifact("bad call id", "x", artifactsRoot),
      ).rejects.toThrow(/callId.*invalid/i);

      // Starts with a hyphen (not alphabetic)
      await expect(
        storeToolArtifact("-badstart", "x", artifactsRoot),
      ).rejects.toThrow(/callId.*invalid/i);

      // Contains a colon (invalid)
      await expect(
        storeToolArtifact("x:y", "x", artifactsRoot),
      ).rejects.toThrow(/callId.*invalid/i);
    } finally {
      await removeDir(artifactsRoot);
    }
  });

  it("rejects suffix with invalid characters", async () => {
    const artifactsRoot = await tempDir();
    try {
      await expect(
        storeToolArtifact("call-ok", "x", artifactsRoot, "text", "../../evil"),
      ).rejects.toThrow(/suffix.*invalid/i);
    } finally {
      await removeDir(artifactsRoot);
    }
  });

  it("accepts valid suffix and produces <callId>-<suffix>.<ext> locator", async () => {
    const artifactsRoot = await tempDir();
    try {
      const ref = await storeToolArtifact(
        "call-003",
        "data",
        artifactsRoot,
        "json",
        "part1",
      );

      expect(ref.locator).toBe("call-003-part1.json");
      expect(ref.kind).toBe("json");

      const filePath = path.join(artifactsRoot, ref.locator);
      const written = await readFile(filePath, "utf-8");
      expect(written).toBe("data");
    } finally {
      await removeDir(artifactsRoot);
    }
  });

  it("produces deterministic locator for same callId+kind+suffix", async () => {
    const artifactsRoot = await tempDir();
    try {
      const ref1 = await storeToolArtifact("det-001", "a", artifactsRoot, "text");
      const ref2 = await storeToolArtifact("det-001", "b", artifactsRoot, "text");

      // Same locator (deterministic, overwrites)
      expect(ref1.locator).toBe(ref2.locator);
      expect(ref1.locator).toBe("det-001.txt");

      // Different ref_id (fresh UUID each time)
      expect(ref1.ref_id).not.toBe(ref2.ref_id);
    } finally {
      await removeDir(artifactsRoot);
    }
  });

  it("produces different locators when suffix differs", async () => {
    const artifactsRoot = await tempDir();
    try {
      const ref1 = await storeToolArtifact("call-sfx", "a", artifactsRoot, "text", "s1");
      const ref2 = await storeToolArtifact("call-sfx", "b", artifactsRoot, "text", "s2");

      expect(ref1.locator).toBe("call-sfx-s1.txt");
      expect(ref2.locator).toBe("call-sfx-s2.txt");
      expect(ref1.locator).not.toBe(ref2.locator);
    } finally {
      await removeDir(artifactsRoot);
    }
  });

  it("generates a unique ref_id per invocation", async () => {
    const artifactsRoot = await tempDir();
    try {
      const ref1 = await storeToolArtifact("uuid-test", "a", artifactsRoot);
      const ref2 = await storeToolArtifact("uuid-test", "b", artifactsRoot);

      expect(ref1.ref_id).not.toBe(ref2.ref_id);

      // Validate UUID v4 format (simple check)
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(ref1.ref_id).toMatch(uuidRe);
      expect(ref2.ref_id).toMatch(uuidRe);
    } finally {
      await removeDir(artifactsRoot);
    }
  });

  it("round-trips through parseContentRef with deep equality", async () => {
    const artifactsRoot = await tempDir();
    try {
      const original = await storeToolArtifact(
        "roundtrip-1",
        "payload",
        artifactsRoot,
        "json",
        "v2",
      );

      // parseContentRef should accept it without throwing
      const parsed = parseContentRef(original);

      // Deep equality — all fields match
      expect(parsed).toEqual(original);

      // Also verify it's a distinct frozen object
      expect(Object.isFrozen(parsed)).toBe(true);
    } finally {
      await removeDir(artifactsRoot);
    }
  });

  it("writes only under artifactsRoot (bedrock separation)", async () => {
    // Create a temp parent dir to act as the workspace root
    const parentDir = await tempDir();
    try {
      const artifactsRoot = path.join(parentDir, "artifacts");
      const bedrockDir = path.join(parentDir, "bedrock");
      const workingDir = path.join(parentDir, "working");
      const logsDir = path.join(parentDir, "logs");

      // Store an artifact
      const ref = await storeToolArtifact("sep-test", "isolated", artifactsRoot);

      // The artifact should be inside artifactsRoot
      const artifactPath = path.join(artifactsRoot, ref.locator);
      const written = await readFile(artifactPath, "utf-8");
      expect(written).toBe("isolated");

      // Scan parent dir for all files — nothing should be in bedrock/working/logs
      const allFiles = await listAllFiles(parentDir);

      // Every file should be under artifactsRoot
      for (const f of allFiles) {
        expect(f).toMatch(/artifacts/);
      }

      // bedrock, working, logs directories should not exist or be empty
      // (they weren't created by our function)
    } finally {
      await removeDir(parentDir);
    }
  });

  it("creates parent directories when artifactsRoot does not exist", async () => {
    const baseDir = await tempDir();
    try {
      const artifactsRoot = path.join(baseDir, "deep", "nested", "artifacts");

      const ref = await storeToolArtifact("mkdir-test", "nested-file", artifactsRoot);

      const filePath = path.join(artifactsRoot, ref.locator);
      const written = await readFile(filePath, "utf-8");
      expect(written).toBe("nested-file");
    } finally {
      await removeDir(baseDir);
    }
  });

  it("does not set media_type for kinds without a mapping", async () => {
    const artifactsRoot = await tempDir();
    try {
      const ref = await storeToolArtifact("no-media", "bin", artifactsRoot, "blob");
      expect(ref.media_type).toBeUndefined();
      expect(ref.kind).toBe("blob");
    } finally {
      await removeDir(artifactsRoot);
    }
  });
});

describe("CALL_ID_PATTERN", () => {
  it.each([
    "abc",
    "a",
    "A1",
    "call_123",
    "call-456",
    "my.call.id",
    "a.b-c_d",
    "xX_0-9.y",
  ])("accepts valid identifier: %s", (value) => {
    expect(CALL_ID_PATTERN.test(value)).toBe(true);
  });

  it.each([
    "",
    " abc",
    "../etc",
    "a/b",
    "a\\b",
    "a:b",
    "-bad",
    ".startsWithDot",
    "_underscore",
  ])("rejects invalid identifier: %s", (value) => {
    expect(CALL_ID_PATTERN.test(value)).toBe(false);
  });
});
