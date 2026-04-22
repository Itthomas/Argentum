from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260421_0003"
down_revision = "20260420_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "memories",
        sa.Column("memory_id", sa.String(length=64), primary_key=True),
        sa.Column(
            "memory_type",
            sa.Enum(
                "user_profile",
                "operator_preference",
                "project_knowledge",
                "environment_fact",
                "task_outcome",
                "procedural_pattern",
                "followup_commitment",
                name="memorytype",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text()),
        sa.Column("embedding_ref", sa.String(length=255)),
        sa.Column(
            "source_kind",
            sa.Enum("task", "session", "operator", "tool_output", "system", "imported", name="memorysourcekind", native_enum=False),
            nullable=False,
        ),
        sa.Column("source_ref", sa.String(length=255)),
        sa.Column("confidence", sa.Numeric(5, 4)),
        sa.Column("recency_weight", sa.Numeric(5, 4)),
        sa.Column("tags", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_memories_memory_type", "memories", ["memory_type"])
    op.create_index("ix_memories_source_kind", "memories", ["source_kind"])

    op.create_table(
        "artifacts",
        sa.Column("artifact_id", sa.String(length=64), primary_key=True),
        sa.Column(
            "artifact_type",
            sa.Enum(
                "report",
                "file",
                "test_result",
                "generated_tool_bundle",
                "external_link",
                "message_snapshot",
                "structured_output",
                name="artifacttype",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("task_id", sa.String(length=64), sa.ForeignKey("tasks.task_id"), nullable=False),
        sa.Column("run_id", sa.String(length=64)),
        sa.Column("storage_ref", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("content_hash", sa.String(length=255)),
        sa.Column(
            "visibility",
            sa.Enum("internal", "operator_visible", "shareable", name="artifactvisibility", native_enum=False),
            nullable=False,
        ),
        sa.Column(
            "retention_class",
            sa.Enum("ephemeral", "operational", "operator_record", "compliance", "generated_tool", name="retentionclass", native_enum=False),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        sa.Column("purge_after_at", sa.DateTime(timezone=True)),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_artifacts_task_id", "artifacts", ["task_id"])

    op.create_table(
        "subagents",
        sa.Column("subagent_id", sa.String(length=64), primary_key=True),
        sa.Column("parent_task_id", sa.String(length=64), sa.ForeignKey("tasks.task_id"), nullable=False),
        sa.Column("child_task_id", sa.String(length=64), sa.ForeignKey("tasks.task_id"), nullable=False),
        sa.Column(
            "role",
            sa.Enum("analysis", "research", "execution", "validation", "tool_authoring", name="subagentrole", native_enum=False),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("proposed", "running", "completed", "failed", "timed_out", "lost", "cancelled", name="subagentstatus", native_enum=False),
            nullable=False,
        ),
        sa.Column("model_policy_ref", sa.String(length=64)),
        sa.Column("delegated_objective", sa.Text(), nullable=False),
        sa.Column("expected_output_contract", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("failed_at", sa.DateTime(timezone=True)),
        sa.Column("timeout_at", sa.DateTime(timezone=True)),
        sa.Column("result_artifact_refs", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("error_summary", sa.Text()),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_subagents_parent_task_id", "subagents", ["parent_task_id"])
    op.create_index("ix_subagents_status", "subagents", ["status"])

    op.create_index("ix_tasks_stale_after_at", "tasks", ["stale_after_at"])


def downgrade() -> None:
    op.drop_index("ix_tasks_stale_after_at", table_name="tasks")
    op.drop_index("ix_subagents_status", table_name="subagents")
    op.drop_index("ix_subagents_parent_task_id", table_name="subagents")
    op.drop_table("subagents")
    op.drop_index("ix_artifacts_task_id", table_name="artifacts")
    op.drop_table("artifacts")
    op.drop_index("ix_memories_source_kind", table_name="memories")
    op.drop_index("ix_memories_memory_type", table_name="memories")
    op.drop_table("memories")