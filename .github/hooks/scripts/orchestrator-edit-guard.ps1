# Orchestrator Edit Guard
# Purpose: Deterministically block the orchestrator from editing source code files.
# This script is invoked as a PreToolUse hook on the `edit` tool for the orchestrator agent only.
# It reads the tool call JSON from stdin and checks the file path.
#
# Exit codes:
#   0 - allow (file is a planning artifact or not an edit to a protected path)
#   2 - deny (file is under packages/, apps/, config/, or docs/spec/)

param()

$rawInput = $null
try {
    $rawInput = [Console]::In.ReadToEnd()
} catch {
    # If stdin is empty or unreadable, allow the tool call (fail-open for safety).
    Write-Output '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    exit 0
}

if ([string]::IsNullOrWhiteSpace($rawInput)) {
    Write-Output '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    exit 0
}

$input = $null
try {
    $input = $rawInput | ConvertFrom-Json
} catch {
    # If JSON parsing fails, allow (fail-open).
    Write-Output '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    exit 0
}

# Only guard edit/write tools. Read-only tools pass through.
$toolName = $input.tool_name
if (-not $toolName) {
    # Can't determine tool name, allow (fail-open).
    Write-Output '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    exit 0
}

# Guard all known edit tool names. The orchestrator's `edit` alias maps
# to one or more of these concrete tool names.
$editToolNames = @(
    'edit',
    'insert_edit_into_file',
    'replace_string_in_file',
    'create_file',
    'create_directory'
)
if ($toolName -notin $editToolNames) {
    Write-Output '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    exit 0
}

# Extract the file path from the tool input.
$filePath = $input.tool_input.filePath
if (-not $filePath) {
    # If we can't determine the file path, allow (fail-open).
    Write-Output '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    exit 0
}

# Normalize and check against protected paths.
$normalized = $filePath -replace '\\', '/'

$protectedPatterns = @(
    'packages/',
    'apps/',
    'config/',
    'docs/spec/'
)

foreach ($pattern in $protectedPatterns) {
    if ($normalized -match $pattern) {
        $reason = "Orchestrator edit guard: `"$filePath`" is under a protected path (`"$pattern`"). The orchestrator must not edit source code, config files, or spec files. Delegate code changes to the argentum-implementer subagent."
        Write-Output "{`"hookSpecificOutput`":{`"hookEventName`":`"PreToolUse`",`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}}"
        exit 2
    }
}

# Allow — the file is under docs/implementation/ or another non-protected path.
Write-Output '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
exit 0
