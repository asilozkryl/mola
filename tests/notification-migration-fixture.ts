import type { DatabaseSync } from "node:sqlite";

/** Reconstruct the pre-v10 queue for real legacy migration/backup fixtures. */
export function restoreLegacyNotificationSchema(db: DatabaseSync) {
  db.exec(`DROP TRIGGER push_diagnostic_subscription_removed;
    DROP INDEX idx_push_outbox_pending;
    ALTER TABLE push_outbox RENAME TO push_outbox_current;
    CREATE TABLE push_outbox(id TEXT PRIMARY KEY,notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL,UNIQUE(notification_id,subscription_id));
    INSERT INTO push_outbox SELECT id,notification_id,subscription_id,attempts,next_attempt FROM push_outbox_current WHERE notification_id IS NOT NULL;
    DROP TABLE push_outbox_current;
    CREATE INDEX idx_push_outbox_pending ON push_outbox(next_attempt);
    DROP TABLE push_diagnostics;
    DROP TABLE notification_policies;
    DROP TABLE channel_notification_preferences;
    DROP TABLE push_delivery_metrics;`);
}
