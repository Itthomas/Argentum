import path from "node:path";

import type {
  Capability,
  ExecutionGrantDTO,
  PathRoot,
  WorkspaceRootsDTO,
} from "@argentum/contracts";

export interface WorkspacePathRequest {
  readonly root: PathRoot;
  readonly relativePath: string;
  readonly capability: Capability;
}

export type WorkspacePathDenialCode =
  | "grant_denied"
  | "permission_denied"
  | "invalid_grant"
  | "invalid_request_path"
  | "path_escape"
  | "bedrock_immutable";

export type WorkspacePathAuthorizationResult =
  | {
      readonly status: "allowed";
      readonly resolvedPath: string;
    }
  | {
      readonly status: "denied";
      readonly code: WorkspacePathDenialCode;
    };

type PathStyle = "posix" | "win32";

interface ParsedAbsolutePath {
  readonly style: PathStyle;
  readonly rootPrefix: string;
  readonly segments: readonly string[];
  readonly comparisonRootPrefix: string;
  readonly comparisonSegments: readonly string[];
  readonly normalized: string;
}

interface RelativePathResolution {
  readonly status: "ok";
  readonly segments: readonly string[];
}

const WINDOWS_DRIVE_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/;
const WINDOWS_DRIVE_RELATIVE_PATTERN = /^[A-Za-z]:(?![\\/])/;
const WINDOWS_NAMESPACE_PATTERN = /^(?:\\\\|\/\/)[?.](?:\\|\/)/;

export function authorizeWorkspacePath(
  workspaceRoots: WorkspaceRootsDTO,
  grant: ExecutionGrantDTO,
  request: WorkspacePathRequest,
): WorkspacePathAuthorizationResult {
  if (grant.approval_mode === "deny") {
    return deny("grant_denied");
  }

  const matchingEntries = grant.path_permissions.filter((entry) => entry.root === request.root);
  if (matchingEntries.length === 0) {
    return deny("permission_denied");
  }

  if (matchingEntries.length > 1) {
    return deny("invalid_grant");
  }

  const entry = matchingEntries[0];
  if (!entry) {
    return deny("invalid_grant");
  }

  const parsedGrantRoot = parseAbsoluteRoot(entry.path);
  if (!parsedGrantRoot) {
    return deny("invalid_grant");
  }

  const parsedCanonicalRoot = parseAbsoluteRoot(workspaceRoots[request.root]);
  if (!parsedCanonicalRoot || !isContainedPath(parsedCanonicalRoot, parsedGrantRoot)) {
    return deny("invalid_grant");
  }

  if (!entry.capabilities.includes(request.capability)) {
    return deny("permission_denied");
  }

  const relativePath = normalizeRelativePath(request.relativePath);
  if (relativePath.status !== "ok") {
    return relativePath;
  }

  return {
    status: "allowed",
    resolvedPath: renderResolvedPath(parsedGrantRoot, relativePath.segments),
  };
}

function deny(code: WorkspacePathDenialCode): Extract<WorkspacePathAuthorizationResult, { status: "denied" }> {
  return {
    status: "denied",
    code,
  };
}

function normalizeRelativePath(requestPath: string): RelativePathResolution | Extract<WorkspacePathAuthorizationResult, { status: "denied" }> {
  if (requestPath.length === 0) {
    return {
      status: "ok",
      segments: [],
    };
  }

  if (WINDOWS_NAMESPACE_PATTERN.test(requestPath)) {
    return deny("invalid_request_path");
  }

  if (WINDOWS_DRIVE_ABSOLUTE_PATTERN.test(requestPath) || WINDOWS_DRIVE_RELATIVE_PATTERN.test(requestPath)) {
    return deny("invalid_request_path");
  }

  if (requestPath.startsWith("/")) {
    return deny("invalid_request_path");
  }

  if (requestPath.startsWith("\\\\") || requestPath.startsWith("//")) {
    return deny("invalid_request_path");
  }

  if (requestPath.startsWith("\\")) {
    return deny("invalid_request_path");
  }

  const segments: string[] = [];

  for (const rawSegment of splitSegments(requestPath)) {
    if (rawSegment.length === 0 || rawSegment === ".") {
      continue;
    }

    if (rawSegment === "..") {
      if (segments.length === 0) {
        return deny("path_escape");
      }

      segments.pop();
      continue;
    }

    segments.push(rawSegment);
  }

  return {
    status: "ok",
    segments,
  };
}

function parseAbsoluteRoot(candidatePath: string): ParsedAbsolutePath | undefined {
  if (candidatePath.length === 0 || WINDOWS_NAMESPACE_PATTERN.test(candidatePath)) {
    return undefined;
  }

  if (WINDOWS_DRIVE_RELATIVE_PATTERN.test(candidatePath)) {
    return undefined;
  }

  if (candidatePath.startsWith("\\\\") || candidatePath.startsWith("//")) {
    return undefined;
  }

  if (candidatePath.startsWith("\\")) {
    return undefined;
  }

  if (WINDOWS_DRIVE_ABSOLUTE_PATTERN.test(candidatePath)) {
    return buildWin32AbsolutePath(candidatePath);
  }

  if (candidatePath.startsWith("/")) {
    return buildPosixAbsolutePath(candidatePath);
  }

  return undefined;
}

function buildPosixAbsolutePath(candidatePath: string): ParsedAbsolutePath {
  const segments = normalizePathSegments(splitSegments(candidatePath));

  return {
    style: "posix",
    rootPrefix: "/",
    segments,
    comparisonRootPrefix: "/",
    comparisonSegments: segments,
    normalized: segments.length === 0 ? "/" : path.posix.join("/", ...segments),
  };
}

function buildWin32AbsolutePath(candidatePath: string): ParsedAbsolutePath {
  const driveLetter = candidatePath.slice(0, 1).toUpperCase();
  const segments = normalizePathSegments(splitSegments(candidatePath.slice(2)));

  return {
    style: "win32",
    rootPrefix: `${driveLetter}:\\`,
    segments,
    comparisonRootPrefix: `${driveLetter}:\\`.toLowerCase(),
    comparisonSegments: segments.map((segment) => segment.toLowerCase()),
    normalized:
      segments.length === 0
        ? `${driveLetter}:\\`
        : path.win32.join(`${driveLetter}:\\`, ...segments),
  };
}

function normalizePathSegments(segments: readonly string[]): string[] {
  const normalized: string[] = [];

  for (const segment of segments) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (normalized.length === 0) {
        continue;
      }

      normalized.pop();
      continue;
    }

    normalized.push(segment);
  }

  return normalized;
}

function isContainedPath(parentPath: ParsedAbsolutePath, childPath: ParsedAbsolutePath): boolean {
  if (parentPath.style !== childPath.style) {
    return false;
  }

  if (parentPath.comparisonRootPrefix !== childPath.comparisonRootPrefix) {
    return false;
  }

  if (parentPath.comparisonSegments.length > childPath.comparisonSegments.length) {
    return false;
  }

  for (const [index, segment] of parentPath.comparisonSegments.entries()) {
    if (childPath.comparisonSegments[index] !== segment) {
      return false;
    }
  }

  return true;
}

function renderResolvedPath(rootPath: ParsedAbsolutePath, relativeSegments: readonly string[]): string {
  if (relativeSegments.length === 0) {
    return rootPath.normalized;
  }

  return rootPath.style === "win32"
    ? path.win32.join(rootPath.normalized, ...relativeSegments)
    : path.posix.join(rootPath.normalized, ...relativeSegments);
}

function splitSegments(value: string): string[] {
  return value.split(/[\\/]+/);
}