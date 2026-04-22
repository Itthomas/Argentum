from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260421_0004"
down_revision = "20260421_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "generated_tools",
        sa.Column("tool_id", sa.String(length=64), primary_key=True),
        sa.Column("tool_name", sa.String(length=255), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("source_task_id", sa.String(length=64), sa.ForeignKey("tasks.task_id"), nullable=False),
        sa.Column("source_artifact_ref", sa.String(length=64), sa.ForeignKey("artifacts.artifact_id"), nullable=False),
        sa.Column("requested_approval_id", sa.String(length=64), sa.ForeignKey("approvals.approval_id")),
        sa.Column(
            "lifecycle_state",
            sa.Enum(
                "proposed",
                "validating",
                "verified",
                "approval_pending",
                "approved",
                "quarantined",
                "limited",
                "global",
                "disabled",
                "superseded",
                "archived",
                name="generatedtoollifecyclestate",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "activation_scope",
            sa.Enum("none", "quarantine", "shadow", "limited", "global", name="toolactivationscope", native_enum=False),
            nullable=False,
        ),
        sa.Column("capability_summary", sa.Text(), nullable=False),
        sa.Column("schema_ref", sa.String(length=255)),
        sa.Column("supersedes_tool_id", sa.String(length=64), sa.ForeignKey("generated_tools.tool_id")),
        sa.Column("superseded_by_tool_id", sa.String(length=64), sa.ForeignKey("generated_tools.tool_id")),
        sa.Column("rollback_of_tool_id", sa.String(length=64), sa.ForeignKey("generated_tools.tool_id")),
        sa.Column("quarantine_until", sa.DateTime(timezone=True)),
        sa.Column("activated_at", sa.DateTime(timezone=True)),
        sa.Column("disabled_at", sa.DateTime(timezone=True)),
        sa.Column("disabled_reason", sa.Text()),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_generated_tools_lifecycle_state", "generated_tools", ["lifecycle_state"])
    op.create_index("ix_generated_tools_activation_scope", "generated_tools", ["activation_scope"])

    op.create_table(
        "activity_records",
        sa.Column("activity_id", sa.String(length=64), primary_key=True),
        sa.Column(
            "activity_kind",
            sa.Enum(
                "task_activity",
                "tool_execution",
                "autonomous_action",
                "provider_routing",
                "generated_tool_lifecycle",
                "recovery",
                name="activitykind",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("task_id", sa.String(length=64), sa.ForeignKey("tasks.task_id")),
        sa.Column("run_id", sa.String(length=64)),
        sa.Column("approval_id", sa.String(length=64), sa.ForeignKey("approvals.approval_id")),
        sa.Column("generated_tool_id", sa.String(length=64), sa.ForeignKey("generated_tools.tool_id")),
        sa.Column("provider_id", sa.String(length=64)),
        sa.Column("model_name", sa.String(length=255)),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("detail", sa.Text()),
        sa.Column("fallback_from_provider_id", sa.String(length=64)),
        sa.Column("fallback_reason", sa.String(length=64)),
        sa.Column("token_count", sa.Integer()),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_activity_records_activity_kind", "activity_records", ["activity_kind"])
    op.create_index("ix_activity_records_task_id", "activity_records", ["task_id"])
    op.create_index("ix_activity_records_generated_tool_id", "activity_records", ["generated_tool_id"])
    op.create_index("ix_activity_records_created_at", "activity_records", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_activity_records_created_at", table_name="activity_records")
    op.drop_index("ix_activity_records_generated_tool_id", table_name="activity_records")
    op.drop_index("ix_activity_records_task_id", table_name="activity_records")
    op.drop_index("ix_activity_records_activity_kind", table_name="activity_records")
    op.drop_table("activity_records")
    op.drop_index("ix_generated_tools_activation_scope", table_name="generated_tools")
    op.drop_index("ix_generated_tools_lifecycle_state", table_name="generated_tools")
    op.drop_table("generated_tools")