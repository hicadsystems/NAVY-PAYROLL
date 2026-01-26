-- Migration: add_token_to_db
-- Created: 2026-01-23T13:37:47.968Z

-- UP
-- Add your schema changes here
ALTER TABLE users ADD COLUMN token TEXT AFTER password;


-- DOWN
-- Add rollback logic here (reverse of UP)
ALTER TABLE users DROP COLUMN token;

