from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from math import ceil
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from argentum.domain.models import (
    ArtifactDigest,
    BootstrapContext,
    ContextBudget,
    ContextPacket,
    EventRecord,
    MemoryDigest,
    RunClass,
    RuntimeFacts,
    SessionDigest,
    TaskDigest,
    TaskRecord,
    TaskSnapshot,
)


class ContextAssemblyError(ValueError):
    """Raised when bounded context assembly cannot satisfy the requested constraints."""


@dataclass(slots=True, frozen=True)
class BootstrapIdentitySource:
    soul_path: Path
    expected_sha256: str | None = None


def _token_count(value: Any) -> int:
    if value is None:
        return 0
    if hasattr(value, "model_dump"):
        serialized = json.dumps(value.model_dump(mode="json"), sort_keys=True)
    else:
        serialized = json.dumps(value, sort_keys=True, default=str)
    # Use a conservative character-based estimate so JSON-heavy packets do not
    # undercount prompt size as severely as simple word splitting.
    return ceil(len(serialized) / 3)


def default_context_budget(run_class: RunClass) -> ContextBudget:
    budget_by_run_class = {
        RunClass.INGRESS_TRIAGE: (1200, 300, 150),
        RunClass.STANDARD_RUNTIME: (2400, 500, 250),
        RunClass.DEEP_PLANNING: (4000, 900, 300),
        RunClass.APPROVAL_REASONING: (2800, 700, 250),
        RunClass.TOOL_AUTHORING: (4200, 900, 400),
        RunClass.HEARTBEAT_MAINTENANCE: (1600, 300, 150),
        RunClass.SUBAGENT_EXECUTION: (2200, 450, 200),
    }
    target_input_tokens, reserved_output_tokens, reserved_tool_schema_tokens = budget_by_run_class[run_class]
    return ContextBudget(
        run_class=run_class,
        target_input_tokens=target_input_tokens,
        reserved_output_tokens=reserved_output_tokens,
        reserved_tool_schema_tokens=reserved_tool_schema_tokens,
        max_bootstrap_tokens=max(200, target_input_tokens // 4),
        max_task_snapshot_tokens=max(180, target_input_tokens // 6),
        max_memory_digest_tokens=max(180, target_input_tokens // 6),
        max_open_task_digest_tokens=max(180, target_input_tokens // 6),
        max_recent_session_tokens=max(160, target_input_tokens // 8),
        max_artifact_digest_tokens=max(120, target_input_tokens // 10),
    )


class ContextAssembler:
    def __init__(self, bootstrap_source: BootstrapIdentitySource) -> None:
        self._bootstrap_source = bootstrap_source

    def load_bootstrap_context(self) -> BootstrapContext:
        notes: list[str] = []
        soul_ref = str(self._bootstrap_source.soul_path)
        if not self._bootstrap_source.soul_path.exists():
            return BootstrapContext(
                soul_ref=soul_ref,
                soul_content="",
                integrity_ok=False,
                content_hash="",
                integrity_notes=["SOUL.md bootstrap identity surface is missing"],
            )

        soul_content = self._bootstrap_source.soul_path.read_text(encoding="utf-8")
        content_hash = sha256(soul_content.encode("utf-8")).hexdigest()
        integrity_ok = True
        if not soul_content.strip():
            integrity_ok = False
            notes.append("SOUL.md bootstrap identity surface is empty")
        if self._bootstrap_source.expected_sha256 is not None and content_hash != self._bootstrap_source.expected_sha256:
            integrity_ok = False
            notes.append("SOUL.md bootstrap identity hash did not match the expected value")

        return BootstrapContext(
            soul_ref=soul_ref,
            soul_content=soul_content,
            integrity_ok=integrity_ok,
            content_hash=content_hash,
            integrity_notes=notes,
        )

    def assemble(
        self,
        event: EventRecord,
        task: TaskRecord | None,
        *,
        runtime_facts: RuntimeFacts,
        run_class: RunClass,
        generated_at: datetime,
        relevant_open_tasks_digest: list[TaskDigest] | None = None,
        relevant_memory_digest: list[MemoryDigest] | None = None,
        recent_session_digest: SessionDigest | None = None,
        recent_artifact_digest: list[ArtifactDigest] | None = None,
        approval_constraints: list[str] | None = None,
        token_budget: ContextBudget | None = None,
    ) -> ContextPacket:
        budget = token_budget or default_context_budget(run_class)
        packet = ContextPacket(
            context_packet_id=f"ctx-{uuid4().hex}",
            event_id=event.event_id,
            task_id=task.task_id if task is not None else None,
            generated_at=generated_at,
            runtime_facts=runtime_facts,
            bootstrap_context=self.load_bootstrap_context(),
            task_snapshot=self._task_snapshot(task),
            relevant_open_tasks_digest=list(relevant_open_tasks_digest or []),
            relevant_memory_digest=list(relevant_memory_digest or []),
            recent_session_digest=recent_session_digest,
            recent_artifact_digest=list(recent_artifact_digest or []),
            approval_constraints=list(approval_constraints or []),
            token_budget=budget,
            assembly_notes=[],
        )
        return self._trim_to_budget(packet)

    def _task_snapshot(self, task: TaskRecord | None) -> TaskSnapshot | None:
        if task is None:
            return None
        return TaskSnapshot(
            task_id=task.task_id,
            status=task.status,
            objective=task.objective,
            success_criteria=task.success_criteria,
            continuation_hint=task.continuation_hint,
            pending_approval_id=task.pending_approval_id,
            artifact_refs=task.artifact_refs,
        )

    def _effective_budget(self, packet: ContextPacket) -> int:
        budget = packet.token_budget
        return budget.target_input_tokens - budget.reserved_output_tokens - budget.reserved_tool_schema_tokens

    def _packet_tokens(self, packet: ContextPacket) -> int:
        return _token_count(packet)

    def _trim_to_budget(self, packet: ContextPacket) -> ContextPacket:
        trimmed = packet.model_copy(deep=True)
        effective_budget = self._effective_budget(trimmed)
        if effective_budget <= 0:
            raise ContextAssemblyError("context budget leaves no room for input assembly")

        budget = trimmed.token_budget

        while _token_count(trimmed.recent_artifact_digest) > budget.max_artifact_digest_tokens and trimmed.recent_artifact_digest:
            trimmed.recent_artifact_digest.pop()
            trimmed.assembly_notes.append("trimmed artifact details to respect artifact budget")

        while self._packet_tokens(trimmed) > effective_budget and trimmed.recent_artifact_digest:
            trimmed.recent_artifact_digest.pop()
            trimmed.assembly_notes.append("trimmed artifact details to stay within context budget")

        while _token_count(trimmed.relevant_open_tasks_digest) > budget.max_open_task_digest_tokens and trimmed.relevant_open_tasks_digest:
            trimmed.relevant_open_tasks_digest.pop()
            trimmed.assembly_notes.append("trimmed open-task digests to respect open-task budget")

        while self._packet_tokens(trimmed) > effective_budget and trimmed.relevant_open_tasks_digest:
            trimmed.relevant_open_tasks_digest.pop()
            trimmed.assembly_notes.append("trimmed open-task digests to stay within context budget")

        while _token_count(trimmed.relevant_memory_digest) > budget.max_memory_digest_tokens and trimmed.relevant_memory_digest:
            trimmed.relevant_memory_digest.pop()
            trimmed.assembly_notes.append("trimmed memory digests to respect memory budget")

        while self._packet_tokens(trimmed) > effective_budget and trimmed.relevant_memory_digest:
            trimmed.relevant_memory_digest.pop()
            trimmed.assembly_notes.append("trimmed memory digests to stay within context budget")

        if trimmed.recent_session_digest is not None and _token_count(trimmed.recent_session_digest) > budget.max_recent_session_tokens:
            trimmed.recent_session_digest = trimmed.recent_session_digest.model_copy(
                update={
                    "summary": self._truncate_words(trimmed.recent_session_digest.summary, 24),
                    "recent_task_ids": trimmed.recent_session_digest.recent_task_ids[:2],
                }
            )
            trimmed.assembly_notes.append("reduced recent-session digest verbosity to respect session budget")

        if self._packet_tokens(trimmed) > effective_budget and trimmed.recent_session_digest is not None:
            trimmed.recent_session_digest = trimmed.recent_session_digest.model_copy(update={"recent_task_ids": []})
            trimmed.assembly_notes.append("reduced recent-session digest verbosity to stay within context budget")

        if trimmed.task_snapshot is not None and _token_count(trimmed.task_snapshot) > budget.max_task_snapshot_tokens:
            trimmed.task_snapshot = trimmed.task_snapshot.model_copy(
                update={
                    "objective": self._truncate_words(trimmed.task_snapshot.objective, 32),
                    "success_criteria": trimmed.task_snapshot.success_criteria[:2],
                    "artifact_refs": trimmed.task_snapshot.artifact_refs[:2],
                }
            )
            trimmed.assembly_notes.append("reduced task snapshot verbosity to respect task budget")

        if self._packet_tokens(trimmed) > effective_budget and trimmed.task_snapshot is not None:
            trimmed.task_snapshot = trimmed.task_snapshot.model_copy(
                update={
                    "objective": self._truncate_words(trimmed.task_snapshot.objective, 16),
                    "success_criteria": trimmed.task_snapshot.success_criteria[:1],
                    "artifact_refs": [],
                }
            )
            trimmed.assembly_notes.append("reduced task snapshot verbosity to stay within context budget")

        if _token_count(trimmed.bootstrap_context) > budget.max_bootstrap_tokens:
            trimmed.bootstrap_context = trimmed.bootstrap_context.model_copy(
                update={"soul_content": self._truncate_words(trimmed.bootstrap_context.soul_content, 48)}
            )
            trimmed.assembly_notes.append("reduced bootstrap context to respect bootstrap budget")

        if self._packet_tokens(trimmed) > effective_budget:
            trimmed.bootstrap_context = trimmed.bootstrap_context.model_copy(
                update={"soul_content": self._truncate_words(trimmed.bootstrap_context.soul_content, 24)}
            )
            trimmed.assembly_notes.append("reduced bootstrap context as a last resort to stay within context budget")

        if self._packet_tokens(trimmed) > effective_budget:
            raise ContextAssemblyError("context assembly could not satisfy the effective prompt budget")
        return trimmed

    def _truncate_words(self, value: str, limit: int) -> str:
        words = value.split()
        if len(words) <= limit:
            return value
        return " ".join(words[:limit])