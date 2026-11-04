-- Gmail links pointed at a message id, which Gmail's web app only opens when the message starts its
-- conversation. Point saved links at the conversation (thread) id instead.
UPDATE "applications" a SET "action_needed" = jsonb_set(a."action_needed", '{link}', to_jsonb(left(a."action_needed"->>'link', length(a."action_needed"->>'link') - length(e."id")) || e."thread_id"))
FROM "emails" e
WHERE e."thread_id" IS NOT NULL AND e."thread_id" <> e."id" AND a."action_needed"->>'link' LIKE 'https://mail.google.com/mail/u/%/#all/' || e."id";
--> statement-breakpoint
UPDATE "events" ev SET "link" = left(ev."link", length(ev."link") - length(e."id")) || e."thread_id"
FROM "emails" e
WHERE ev."email_id" = e."id" AND e."thread_id" IS NOT NULL AND e."thread_id" <> e."id" AND ev."link" LIKE 'https://mail.google.com/mail/u/%/#all/' || e."id";
--> statement-breakpoint
UPDATE "emails" SET "link" = left("link", length("link") - length("id")) || "thread_id"
WHERE "thread_id" IS NOT NULL AND "thread_id" <> "id" AND "link" LIKE 'https://mail.google.com/mail/u/%/#all/' || "id";
