-- Seed the storefront_url system config so the admin Settings page can
-- display and copy the customer storefront link.
INSERT INTO "system_configs" (id, key, value, label, "group")
VALUES (
  uuid_generate_v4(),
  'storefront_url',
  '"https://customer-eta-ruby.vercel.app"',
  'Storefront URL',
  'general'
)
ON CONFLICT (key) DO NOTHING;
