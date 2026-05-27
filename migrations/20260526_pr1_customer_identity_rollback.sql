-- PR1 DOWN — for a failed migration BEFORE go-live only.
-- Once real customers/orders exist, DO NOT run this; fix forward instead.

-- Drop policies (safe even if they don't exist)
DROP POLICY IF EXISTS consents_self_select   ON public.customer_consents;
DROP POLICY IF EXISTS identities_self_select ON public.customer_identities;

-- Drop trigger
DROP TRIGGER IF EXISTS trg_customers_updated ON public.customers;

-- Drop new tables
DROP TABLE IF EXISTS public.customer_consents;
DROP TABLE IF EXISTS public.customer_identities;
DROP FUNCTION IF EXISTS public.next_order_number(text);
DROP TABLE IF EXISTS public.order_number_counters;

-- Drop function (keep if other code may use it)
DROP FUNCTION IF EXISTS public.set_updated_at();

-- Remove added columns from customers (reverse order of addition)
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS chk_customers_status;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS chk_customers_source;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS chk_customers_line_friend_status;

ALTER TABLE public.customers DROP COLUMN IF EXISTS merged_into;
ALTER TABLE public.customers DROP COLUMN IF EXISTS status;
ALTER TABLE public.customers DROP COLUMN IF EXISTS source;
ALTER TABLE public.customers DROP COLUMN IF EXISTS line_last_event_at;
ALTER TABLE public.customers DROP COLUMN IF EXISTS line_friend_status;
ALTER TABLE public.customers DROP COLUMN IF EXISTS line_picture_url;
ALTER TABLE public.customers DROP COLUMN IF EXISTS line_display_name;
ALTER TABLE public.customers DROP COLUMN IF EXISTS line_user_id;
ALTER TABLE public.customers DROP COLUMN IF EXISTS primary_email;
ALTER TABLE public.customers DROP COLUMN IF EXISTS primary_phone_e164;
ALTER TABLE public.customers DROP COLUMN IF EXISTS display_name;
ALTER TABLE public.customers DROP COLUMN IF EXISTS auth_user_id;
