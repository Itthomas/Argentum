export interface WorkspaceRootsDTO {
  bedrock: string;
  working: string;
  artifacts: string;
  logs: string;
}

export interface RuntimePolicyDTO {
  enabled_tools: string[];
  enabled_secret_handles: string[];
  max_tool_runtime_ms: number;
  workspace_roots: WorkspaceRootsDTO;
  trusted_local_mode: boolean;
}