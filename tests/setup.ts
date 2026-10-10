process.env.TZ = "UTC";
process.env.GOOGLE_MOCK = "true";
// Tests are hermetic: a developer's local .env (real impersonated owner / Drive root) must not leak into mock-mode ids.
process.env.GOOGLE_IMPERSONATE_USER = "";
process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = "";
process.env.VAULT_ENCRYPTION_KEY ??= "dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktdGVzdC0xMjM=";
