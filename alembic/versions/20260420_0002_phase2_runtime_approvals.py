from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260420_0002"
down_revision = "20260420_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "approvals",
        sa.Column("approval_id", sa.String(length=64), primary_key=True),
        sa.Column("task_id", sa.String(length=64), sa.ForeignKey("tasks.task_id"), nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column(
            "approval_type",
            sa.Enum(
                "tool_activation",
                "destructive_action",
                "privileged_execution",
                "external_side_effect",
                "policy_exception",
                name="approvaltype",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "risk_level",
            sa.Enum("low", "medium", "high", "critical", name="risklevel", native_enum=False),
            nullable=False,
        ),
        sa.Column("requested_action", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("constrained_options", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("request_payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("eligible_resolver_refs", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "reminded",
                "approved",
                "denied",
                "expired",
                "cancelled",
                name="approvalstatus",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("requested_via_session_id", sa.String(length=64), sa.ForeignKey("sessions.session_id")),
        sa.Column("requested_via_message_ref", sa.String(length=255)),
        sa.Column("reminder_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_reminder_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_by_user_id", sa.String(length=255)),
        sa.Column("resolved_by_session_id", sa.String(length=64), sa.ForeignKey("sessions.session_id")),
        sa.Column("resolution_payload_hash", sa.String(length=255)),
        sa.Column(
            "decision",
            sa.Enum("approve", "deny", "cancel", name="approvaldecision", native_enum=False),
        ),
        sa.Column("operator_comment", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_approvals_status", "approvals", ["status"])
    op.create_index("ix_approvals_expires_at", "approvals", ["expires_at"])

    op.create_table(
        "model_routing_policies",
        sa.Column("policy_id", sa.String(length=64), primary_key=True),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("provider_mappings", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("operation_mappings", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("timeout_profiles", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("fallback_profiles", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("budget_profiles", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_model_routing_policies_active", "model_routing_policies", ["active"])

    op.create_table(
        "provider_health",
        sa.Column("provider_id", sa.String(length=64), primary_key=True),
        sa.Column(
            "health_status",
            sa.Enum("healthy", "degraded", "unavailable", name="providerhealthstatus", native_enum=False),
            nullable=False,
        ),
        sa.Column("last_success_at", sa.DateTime(timezone=True)),
        sa.Column("last_timeout_at", sa.DateTime(timezone=True)),
        sa.Column("last_rate_limit_at", sa.DateTime(timezone=True)),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("degraded_until", sa.DateTime(timezone=True)),
        sa.Column("notes", sa.Text()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("provider_health")
    op.drop_index("ix_model_routing_policies_active", table_name="model_routing_policies")
    op.drop_table("model_routing_policies")
    op.drop_index("ix_approvals_expires_at", table_name="approvals")
    op.drop_index("ix_approvals_status", table_name="approvals")
    op.drop_table("approvals")