-- 0010_app_settings.sql
-- Runtime app settings, filled by the first-run onboarding wizard. A single
-- row (id = 1) holds the instance's identity + preferences so they can be
-- changed at runtime instead of being baked in at build time. Secrets
-- (SMTP/Resend credentials, JWT, DB, encryption keys) stay in .env — never here.

CREATE TABLE IF NOT EXISTS app_settings (
    id               smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    onboarded        boolean     NOT NULL DEFAULT false,
    app_name         text        NOT NULL DEFAULT 'Tillforty',
    default_language text        NOT NULL DEFAULT 'en',
    currency_code    text        NOT NULL DEFAULT 'EUR',
    currency_symbol  text        NOT NULL DEFAULT '€',
    timezone         text        NOT NULL DEFAULT 'Europe/Vilnius',
    demo_mode        boolean     NOT NULL DEFAULT false,
    from_name        text        NOT NULL DEFAULT '',
    from_email       text        NOT NULL DEFAULT '',
    support_email    text        NOT NULL DEFAULT '',
    logo             bytea,
    logo_mime        text,
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Ensure the singleton row exists. Migrations run BEFORE the app seeds its
-- users, so a genuinely fresh database has zero users here → onboarded=false
-- (the wizard will show). An EXISTING install already has its users → mark it
-- onboarded=true so upgrading in place never forces the wizard on a live app.
INSERT INTO app_settings (id, onboarded)
VALUES (1, (SELECT count(*) > 0 FROM users))
ON CONFLICT (id) DO NOTHING;
