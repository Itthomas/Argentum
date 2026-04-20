from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260420_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column("event_id", sa.String(length=64), primary_key=True),
        sa.Column("event_type", sa.Enum(
            "user_message", "approval_response", "heartbeat_tick", "cron_trigger", "webhook_trigger", "system_followup", "task_resume_request", "child_completion", "child_failure", name="eventtype", native_enum=False
        ), nullable=False),
        sa.Column("trigger_mode", sa.Enum("interactive", "scheduled", "autonomous", "approval_resume", "recovery", name="triggermode", native_enum=False), nullable=False),
        sa.Column("source_surface", sa.String(length=64), nullable=False),
        sa.Column("source_channel_id", sa.String(length=255)),
        sa.Column("source_thread_ref", sa.String(length=255)),
        sa.Column("source_user_id", sa.String(length=255)),
        sa.Column("source_message_ref", sa.String(length=255)),
        sa.Column("authenticated_principal_ref", sa.String(length=255)),
        sa.Column("auth_status", sa.Enum("not_applicable", "pending", "authenticated", "rejected_unauthenticated", "rejected_unauthorized", name="eventauthstatus", native_enum=False), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), unique=True),
        sa.Column("replay_window_key", sa.String(length=255)),
        sa.Column("replay_window_expires_at", sa.DateTime(timezone=True)),
        sa.Column("payload_text", sa.Text()),
        sa.Column("payload_structured", sa.JSON()),
        sa.Column("attachment_refs", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("explicit_task_refs", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("inferred_task_candidates", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("approval_response_data", sa.JSON()),
        sa.Column("heartbeat_data", sa.JSON()),
        sa.Column("cron_data", sa.JSON()),
        sa.Column("webhook_data", sa.JSON()),
        sa.Column("queue_class", sa.Enum("interactive", "approval", "scheduled", "recovery", "maintenance", name="queueclass", native_enum=False)),
        sa.Column("queue_priority", sa.Integer()),
        sa.Column("queue_owner", sa.String(length=255)),
        sa.Column("queued_at", sa.DateTime(timezone=True)),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True)),
        sa.Column("delivery_attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processing_status", sa.Enum("received", "rejected_unauthenticated", "rejected_unauthorized", "deduplicated", "queued", "consumed", "ignored", "failed", "dead_lettered", name="eventprocessingstatus", native_enum=False), nullable=False),
        sa.Column("processing_error", sa.Text()),
        sa.Column("dead_letter_reason", sa.Text()),
        sa.Column("consumed_by_run_id", sa.String(length=64)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_events_processing_status", "events", ["processing_status"])
    op.create_index("ix_events_next_attempt_at", "events", ["next_attempt_at"])

    op.create_table(
        "tasks",
        sa.Column("task_id", sa.String(length=64), primary_key=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("objective", sa.Text(), nullable=False),
        sa.Column("normalized_objective", sa.Text(), nullable=False),
        sa.Column("task_type", sa.Enum("conversation_task", "research_task", "execution_task", "maintenance_task", "followup_task", "child_task", "tool_authoring_task", "approval_task", name="tasktype", native_enum=False), nullable=False),
        sa.Column("status", sa.Enum("proposed", "active", "waiting_human", "blocked", "scheduled", "completed", "failed", "abandoned", "stalled", "blocked_timeout", "failed_timeout", "expired", "needs_operator_attention", name="taskstatus", native_enum=False), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("confidence_score", sa.Numeric(5, 4)),
        sa.Column("created_by_event_id", sa.String(length=64), sa.ForeignKey("events.event_id"), nullable=False),
        sa.Column("origin_session_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("origin_thread_refs", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("assigned_runtime_lane", sa.String(length=64)),
        sa.Column("active_run_id", sa.String(length=64)),
        sa.Column("parent_task_id", sa.String(length=64), sa.ForeignKey("tasks.task_id")),
        sa.Column("child_task_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("latest_summary", sa.Text()),
        sa.Column("latest_summary_at", sa.DateTime(timezone=True)),
        sa.Column("success_criteria", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("continuation_hint", sa.Text()),
        sa.Column("blocked_reason", sa.Text()),
        sa.Column("pending_approval_id", sa.String(length=64)),
        sa.Column("artifact_refs", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("related_memory_refs", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("last_operator_confirmation_at", sa.DateTime(timezone=True)),
        sa.Column("next_followup_at", sa.DateTime(timezone=True)),
        sa.Column("stale_after_at", sa.DateTime(timezone=True)),
        sa.Column("abandoned_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("failed_at", sa.DateTime(timezone=True)),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_tasks_status", "tasks", ["status"])
    op.create_index("ix_tasks_next_followup_at", "tasks", ["next_followup_at"])

    op.create_table(
        "sessions",
        sa.Column("session_id", sa.String(length=64), primary_key=True),
        sa.Column("session_key", sa.String(length=255), unique=True, nullable=False),
        sa.Column("channel_type", sa.Enum("slack_dm", "slack_channel", "webhook", "internal", "scheduled", name="channeltype", native_enum=False), nullable=False),
        sa.Column("channel_id", sa.String(length=255), nullable=False),
        sa.Column("peer_id", sa.String(length=255)),
        sa.Column("user_id", sa.String(length=255)),
        sa.Column("active_thread_ref", sa.String(length=255)),
        sa.Column("transcript_ref", sa.String(length=255)),
        sa.Column("current_task_id", sa.String(length=64), sa.ForeignKey("tasks.task_id")),
        sa.Column("recent_task_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("approval_capabilities", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("delivery_capabilities", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("runtime_flags", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("latest_activity_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "task_claims",
        sa.Column("claim_id", sa.String(length=64), primary_key=True),
        sa.Column("task_id", sa.String(length=64), sa.ForeignKey("tasks.task_id"), nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("claimed_by", sa.String(length=255), nullable=False),
        sa.Column("claim_state", sa.Enum("active", "released", "expired", "superseded", "invalidated", name="claimstate", native_enum=False), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_lease_renewal_at", sa.DateTime(timezone=True)),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("released_at", sa.DateTime(timezone=True)),
        sa.Column("release_reason", sa.Enum("completed", "failed", "abandoned", "lease_expired", "runtime_shutdown", "recovery_reclaimed", "operator_cancelled", name="claimreleasereason", native_enum=False)),
        sa.Column("superseded_by_claim_id", sa.String(length=64), sa.ForeignKey("task_claims.claim_id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_task_claims_lease_expires_at", "task_claims", ["lease_expires_at"])
    op.create_index("ix_task_claims_task_state", "task_claims", ["task_id", "claim_state"])


def downgrade() -> None:
    op.drop_index("ix_task_claims_task_state", table_name="task_claims")
    op.drop_index("ix_task_claims_lease_expires_at", table_name="task_claims")
    op.drop_table("task_claims")
    op.drop_table("sessions")
    op.drop_index("ix_tasks_next_followup_at", table_name="tasks")
    op.drop_index("ix_tasks_status", table_name="tasks")
    op.drop_table("tasks")
    op.drop_index("ix_events_next_attempt_at", table_name="events")
    op.drop_index("ix_events_processing_status", table_name="events")
    op.drop_table("events")