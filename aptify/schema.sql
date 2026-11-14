-- =====================================================================
-- Aptify: complete Supabase schema (Postgres 15+), normalized to 3NF
--
-- This is the FINAL version. It already contains everything from the
-- earlier steps (initial schema, signup flow, landlord overview,
-- units and invites, maintenance, payment details, account deletion, announcements) plus the user_roles view.
-- Run it ONCE on a fresh Supabase project (SQL editor). Do not run it on a
-- database that already has these tables.
--
-- Design rules
--  * No "role" column on users. A person is a landlord if they own a
--    property and a tenant if they hold a lease, so one account can be
--    both (your "Landlord and tenant" label).
--  * Derived values are NOT stored: unit count, bill totals, balances,
--    bill status, invite status. They come from views.
--  * Bill items are a snapshot, so changing lease terms never rewrites
--    past bills.
--  * Money is numeric(12,2), in PHP.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- ENUMS ----------------------------------------------------
create type property_type        as enum ('apartment_building','boarding_house','townhouse','other');
create type lease_status         as enum ('pending','active','ended');
create type bill_type            as enum ('monthly','move_in');
create type charge_category      as enum ('rent','utility','fee','deposit','advance_rent','repair','penalty','cleaning','other');
create type charge_mode          as enum ('fixed','variable');
create type payment_method       as enum ('gcash','maya','cash');
create type payment_status       as enum ('pending','confirmed','rejected');
create type rejection_reason     as enum ('not_received','wrong_amount','other');
create type maintenance_category as enum ('plumbing','electrical','appliance','carpentry','other');
create type urgency_level        as enum ('low','medium','urgent');
create type maintenance_status   as enum ('new','assigned','resolved');
create type announcement_audience as enum ('property','units');
create type announcement_status  as enum ('draft','published');
create type notification_type    as enum ('repair_request','repair_update','cash_notice','cash_rejected',
                                          'tenant_joined','rent_overdue','payment_received',
                                          'announcement','rent_reminder','bill_issued');

-- ---------- HELPERS --------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- 1. PEOPLE ------------------------------------------------
-- Email and password live in auth.users. Do not duplicate them here.
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  first_name  text not null check (length(trim(first_name)) > 0),
  last_name   text not null check (length(trim(last_name))  > 0),
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table notification_preferences (
  user_id         uuid primary key references profiles(id) on delete cascade,
  rent_reminders  boolean not null default true,
  repair_updates  boolean not null default true,
  announcements   boolean not null default true
);

-- Signup form sends first_name / last_name in options.data
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, first_name, last_name)
  values (new.id, new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name');
  insert into notification_preferences (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- ---------- 2. PROPERTIES AND UNITS ---------------------------------
create table properties (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references profiles(id) on delete restrict,
  name           text not null,
  street_address text not null,
  city           text not null,
  province       text not null,
  property_type  property_type not null default 'apartment_building',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on properties(owner_id);

create table units (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,
  label        text not null,                       -- "Unit 4B"
  listed_rent  numeric(12,2) check (listed_rent >= 0),  -- shown for vacant units
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (property_id, label)
);

-- ---------- 3. LEASES ------------------------------------------------
-- A lease is created as 'pending' when the landlord sets terms and
-- generates an invite. Redeeming the invite attaches the tenant and
-- activates it.
create table leases (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references units(id) on delete cascade,
  tenant_id   uuid references profiles(id) on delete restrict,   -- null until invite redeemed
  status      lease_status not null default 'pending',
  start_date  date not null,
  end_date    date,
  security_deposit numeric(12,2) not null default 0 check (security_deposit >= 0),
  advance_rent     numeric(12,2) not null default 0 check (advance_rent >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (status <> 'active' or tenant_id is not null)   -- only ACTIVE leases need a tenant
);
create index on leases(tenant_id);
-- One pending/active lease per unit at a time
create unique index one_open_lease_per_unit on leases(unit_id) where status in ('pending','active');

-- Versioned terms. "Apply changes from next bill / a specific month".
create table lease_terms (
  id             uuid primary key default gen_random_uuid(),
  lease_id       uuid not null references leases(id) on delete cascade,
  effective_from date not null,                      -- first day of the first month using these terms
  monthly_rent   numeric(12,2) not null check (monthly_rent >= 0),
  due_day        smallint not null check (due_day between 1 and 28),
  change_reason  text,
  created_by     uuid not null references profiles(id),
  created_at     timestamptz not null default now(),
  unique (lease_id, effective_from)
);

-- Recurring charges: association dues (fixed), electricity/water (variable)
create table lease_charges (
  id            uuid primary key default gen_random_uuid(),
  lease_id      uuid not null references leases(id) on delete cascade,
  name          text not null,
  category      charge_category not null check (category in ('utility','fee','other')),
  mode          charge_mode not null,
  fixed_amount  numeric(12,2) check (fixed_amount >= 0),
  active        boolean not null default true,
  check ((mode = 'fixed' and fixed_amount is not null) or (mode = 'variable' and fixed_amount is null)),
  unique (lease_id, name)
);

-- ---------- 4. INVITES ----------------------------------------------
-- Readable invite codes in the format APT-XXXX-XX (no 0/O/1/I)
create or replace function gen_invite_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := 'APT-';
  i int;
begin
  for i in 1..6 loop
    code := code || substr(alphabet, (get_byte(gen_random_bytes(1), 0) % 32) + 1, 1);
    if i = 4 then code := code || '-'; end if;
  end loop;
  return code;
end $$;

-- Single-use code per lease. Status (pending/joined/expired/revoked) is derived.
create table unit_invites (
  id             uuid primary key default gen_random_uuid(),
  lease_id       uuid not null references leases(id) on delete cascade,
  code           text not null unique default gen_invite_code(),
  invitee_name   text,
  invitee_email  text,
  created_by     uuid not null references profiles(id),
  expires_at     timestamptz not null default now() + interval '7 days',
  redeemed_by    uuid references profiles(id),
  redeemed_at    timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  check ((redeemed_at is null) = (redeemed_by is null)),
  check (not (redeemed_at is not null and revoked_at is not null))
);
-- Only one live invite per lease
create unique index one_live_invite_per_lease on unit_invites(lease_id)
  where redeemed_at is null and revoked_at is null;

create view invite_status with (security_invoker = true) as
select i.*,
  case when i.redeemed_at is not null then 'joined'
       when i.revoked_at  is not null then 'revoked'
       when i.expires_at < now()      then 'expired'
       else 'pending' end as status
from unit_invites i;

-- ---------- 5. BILLING ----------------------------------------------
create table bills (
  id             uuid primary key default gen_random_uuid(),
  lease_id       uuid not null references leases(id) on delete cascade,
  bill_type      bill_type not null default 'monthly',
  billing_period date not null check (extract(day from billing_period) = 1),  -- first of month
  due_date       date not null,
  discount       numeric(12,2) not null default 0 check (discount >= 0),
  created_by     uuid not null references profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (lease_id, billing_period, bill_type)
);
create index on bills(lease_id);

-- Snapshot of what was charged. Rent, utilities, fees, one-time charges.
create table bill_items (
  id           uuid primary key default gen_random_uuid(),
  bill_id      uuid not null references bills(id) on delete cascade,
  description  text not null,
  category     charge_category not null,
  amount       numeric(12,2) not null check (amount >= 0),
  sort_order   smallint not null default 0
);
create index on bill_items(bill_id);

-- ---------- 6. PAYMENTS AND RECEIPTS --------------------------------
create table payments (
  id                 uuid primary key default gen_random_uuid(),
  bill_id            uuid not null references bills(id) on delete restrict,
  payer_id           uuid not null references profiles(id),
  amount             numeric(12,2) not null check (amount > 0),
  method             payment_method not null,
  status             payment_status not null default 'pending',
  planned_date       date,                    -- cash notice: when tenant plans to pay
  received_on        date,                    -- when money actually arrived
  reference_no       text,                    -- GCash / Maya ref
  note               text,
  confirmed_by       uuid references profiles(id),
  confirmed_at       timestamptz,
  rejection_reason   rejection_reason,
  rejection_message  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (status <> 'confirmed' or (confirmed_at is not null and received_on is not null)),
  check ((status = 'rejected') = (rejection_reason is not null))
);
create index on payments(bill_id);
create index on payments(payer_id);
create index on payments(status);

create table receipt_counters (
  property_id  uuid not null references properties(id) on delete cascade,
  year         int  not null,
  last_number  int  not null default 0,
  primary key (property_id, year)
);

create table receipts (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid not null unique references payments(id) on delete restrict,
  property_id  uuid not null references properties(id),
  year         int  not null,
  sequence_no  int  not null,
  receipt_no   text generated always as ('OR-' || year::text || '-' || lpad(sequence_no::text, 4, '0')) stored,
  issued_at    timestamptz not null default now(),
  unique (property_id, year, sequence_no)
);

-- Totals, balances and status are always derived
create view bill_summary with (security_invoker = true) as
select b.id as bill_id, b.lease_id, b.bill_type, b.billing_period, b.due_date,
       t.subtotal, b.discount, (t.subtotal - b.discount) as total_due,
       p.paid, (t.subtotal - b.discount - p.paid) as balance,
       case when t.subtotal - b.discount - p.paid <= 0 and t.subtotal > 0 then 'paid'
            when p.paid > 0 then 'partially_paid'
            when b.due_date < current_date then 'overdue'
            else 'unpaid' end as status,
       exists (select 1 from payments x where x.bill_id = b.id and x.status = 'pending') as has_pending_payment
from bills b
cross join lateral (select coalesce(sum(amount),0) as subtotal from bill_items where bill_id = b.id) t
cross join lateral (select coalesce(sum(amount),0) as paid from payments
                    where bill_id = b.id and status = 'confirmed') p;

-- ---------- 7. MAINTENANCE ------------------------------------------
create table technicians (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,
  name         text not null,
  specialty    text,
  phone        text,
  active       boolean not null default true
);

create table maintenance_requests (
  id                uuid primary key default gen_random_uuid(),
  unit_id           uuid not null references units(id) on delete cascade,
  requested_by      uuid not null references profiles(id),
  category          maintenance_category not null,
  urgency           urgency_level not null default 'medium',
  title             text not null,
  description       text not null,
  preferred_time    text,
  status            maintenance_status not null default 'new',
  technician_id     uuid references technicians(id) on delete set null,
  visit_at          timestamptz,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on maintenance_requests(unit_id);
create index on maintenance_requests(status);

create table maintenance_photos (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references maintenance_requests(id) on delete cascade,
  storage_path text not null,                 -- Supabase Storage object path
  created_at   timestamptz not null default now()
);

create table maintenance_comments (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references maintenance_requests(id) on delete cascade,
  author_id   uuid not null references profiles(id),
  body        text not null,
  created_at  timestamptz not null default now()
);
create index on maintenance_comments(request_id);

-- Progress timeline ("Request received", "Assigned to Mang Rudy", "Resolved")
create table maintenance_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references maintenance_requests(id) on delete cascade,
  status      maintenance_status not null,
  actor_id    uuid references profiles(id),
  note        text,
  created_at  timestamptz not null default now()
);
create index on maintenance_events(request_id);

-- ---------- 8. ANNOUNCEMENTS ----------------------------------------
create table announcements (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id) on delete cascade,
  author_id     uuid not null references profiles(id),
  title         text not null,
  body          text not null,
  audience      announcement_audience not null default 'property',
  notify_email  boolean not null default false,
  status        announcement_status not null default 'draft',
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((status = 'published') = (published_at is not null))
);
create index on announcements(property_id);

-- Only used when audience = 'units'
create table announcement_units (
  announcement_id uuid not null references announcements(id) on delete cascade,
  unit_id         uuid not null references units(id) on delete cascade,
  primary key (announcement_id, unit_id)
);

-- ---------- 9. NOTIFICATIONS ----------------------------------------
create table notifications (
  id                      uuid primary key default gen_random_uuid(),
  recipient_id            uuid not null references profiles(id) on delete cascade,
  type                    notification_type not null,
  title                   text not null,
  body                    text,
  property_id             uuid references properties(id) on delete cascade,
  unit_id                 uuid references units(id) on delete cascade,
  payment_id              uuid references payments(id) on delete cascade,
  bill_id                 uuid references bills(id) on delete cascade,
  maintenance_request_id  uuid references maintenance_requests(id) on delete cascade,
  announcement_id         uuid references announcements(id) on delete cascade,
  read_at                 timestamptz,
  created_at              timestamptz not null default now()
);
create index on notifications(recipient_id, read_at);

-- ---------- updated_at triggers -------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','properties','units','leases','bills','payments',
                           'maintenance_requests','announcements']
  loop
    execute format('create trigger trg_%I_updated before update on %I
                    for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- =====================================================================
-- ACCESS HELPERS (security definer so RLS policies don't recurse)
-- =====================================================================
create or replace function owns_property(p_property uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from properties where id = p_property and owner_id = auth.uid()) $$;

create or replace function manages_unit(p_unit uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from units u join properties p on p.id = u.property_id
                 where u.id = p_unit and p.owner_id = auth.uid()) $$;

create or replace function is_unit_tenant(p_unit uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from leases where unit_id = p_unit
                 and tenant_id = auth.uid() and status = 'active') $$;

create or replace function manages_lease(p_lease uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from leases l join units u on u.id = l.unit_id
                 join properties p on p.id = u.property_id
                 where l.id = p_lease and p.owner_id = auth.uid()) $$;

create or replace function is_lease_tenant(p_lease uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from leases where id = p_lease
                 and tenant_id = auth.uid() and status = 'active') $$;

create or replace function manages_bill(p_bill uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from bills where id = p_bill and manages_lease(lease_id)) $$;

create or replace function is_bill_tenant(p_bill uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from bills where id = p_bill and is_lease_tenant(lease_id)) $$;

create or replace function shares_lease_with(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from leases l join units u on u.id = l.unit_id join properties p on p.id = u.property_id
    where (l.tenant_id = p_other and p.owner_id = auth.uid())
       or (l.tenant_id = auth.uid() and p.owner_id = p_other)) $$;

-- Does the logged-in user own the property this announcement belongs to?
create or replace function owns_announcement(p_announcement uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from announcements a
      join properties p on p.id = a.property_id
     where a.id = p_announcement and p.owner_id = auth.uid()) $$;

-- Can the logged-in tenant see this announcement? (posted, and meant for them)
create or replace function can_view_announcement(p_announcement uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from announcements a
     where a.id = p_announcement
       and a.status = 'published'
       and (
         (a.audience = 'property' and exists (
            select 1 from units u join leases l on l.unit_id = u.id
             where u.property_id = a.property_id
               and l.tenant_id = auth.uid() and l.status = 'active'))
         or
         (a.audience = 'units' and exists (
            select 1 from announcement_units au join leases l on l.unit_id = au.unit_id
             where au.announcement_id = a.id
               and l.tenant_id = auth.uid() and l.status = 'active'))
       )) $$;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table profiles                enable row level security;
alter table notification_preferences enable row level security;
alter table properties              enable row level security;
alter table units                   enable row level security;
alter table leases                  enable row level security;
alter table lease_terms             enable row level security;
alter table lease_charges           enable row level security;
alter table unit_invites            enable row level security;
alter table bills                   enable row level security;
alter table bill_items              enable row level security;
alter table payments                enable row level security;
alter table receipt_counters        enable row level security;
alter table receipts                enable row level security;
alter table technicians             enable row level security;
alter table maintenance_requests    enable row level security;
alter table maintenance_photos      enable row level security;
alter table maintenance_comments    enable row level security;
alter table maintenance_events      enable row level security;
alter table announcements           enable row level security;
alter table announcement_units      enable row level security;
alter table notifications           enable row level security;

-- Profiles
create policy profiles_read   on profiles for select using (id = auth.uid() or shares_lease_with(id));
create policy profiles_update on profiles for update using (id = auth.uid());
create policy prefs_own       on notification_preferences for all using (user_id = auth.uid());

-- Properties and units
create policy properties_owner  on properties for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy properties_tenant on properties for select using (
  exists (select 1 from units u where u.property_id = properties.id and is_unit_tenant(u.id)));
create policy units_owner  on units for all using (owns_property(property_id)) with check (owns_property(property_id));
create policy units_tenant on units for select using (is_unit_tenant(id));

-- Leases, terms, charges
create policy leases_owner  on leases for all using (manages_unit(unit_id)) with check (manages_unit(unit_id));
create policy leases_tenant on leases for select using (tenant_id = auth.uid());
create policy terms_owner   on lease_terms   for all using (manages_lease(lease_id)) with check (manages_lease(lease_id));
create policy terms_tenant  on lease_terms   for select using (is_lease_tenant(lease_id));
create policy charges_owner  on lease_charges for all using (manages_lease(lease_id)) with check (manages_lease(lease_id));
create policy charges_tenant on lease_charges for select using (is_lease_tenant(lease_id));

-- Invites: landlords manage; tenants redeem through redeem_invite() only
create policy invites_owner on unit_invites for all using (manages_lease(lease_id)) with check (manages_lease(lease_id));

-- Bills and items
create policy bills_owner  on bills for all using (manages_lease(lease_id)) with check (manages_lease(lease_id));
create policy bills_tenant on bills for select using (is_lease_tenant(lease_id));
create policy items_owner  on bill_items for all using (manages_bill(bill_id)) with check (manages_bill(bill_id));
create policy items_tenant on bill_items for select using (is_bill_tenant(bill_id));

-- Payments: tenants can read theirs and file a pending cash notice only
create policy payments_owner  on payments for all using (manages_bill(bill_id)) with check (manages_bill(bill_id));
create policy payments_tenant_read on payments for select using (is_bill_tenant(bill_id));
create policy payments_tenant_notice on payments for insert with check (
  payer_id = auth.uid() and method = 'cash' and status = 'pending' and is_bill_tenant(bill_id));

create policy counters_owner on receipt_counters for select using (owns_property(property_id));
create policy receipts_owner  on receipts for select using (owns_property(property_id));
create policy receipts_tenant on receipts for select using (
  exists (select 1 from payments p where p.id = receipts.payment_id and p.payer_id = auth.uid()));

-- Maintenance
create policy tech_owner on technicians for all using (owns_property(property_id)) with check (owns_property(property_id));
create policy mreq_owner on maintenance_requests for all using (manages_unit(unit_id)) with check (manages_unit(unit_id));
create policy mreq_tenant_read   on maintenance_requests for select using (is_unit_tenant(unit_id));
create policy mreq_tenant_insert on maintenance_requests for insert with check (
  requested_by = auth.uid() and is_unit_tenant(unit_id));

create policy mphotos_access on maintenance_photos for all using (
  exists (select 1 from maintenance_requests r where r.id = request_id
          and (manages_unit(r.unit_id) or is_unit_tenant(r.unit_id))))
  with check (
  exists (select 1 from maintenance_requests r where r.id = request_id
          and (manages_unit(r.unit_id) or is_unit_tenant(r.unit_id))));
create policy mcomments_read on maintenance_comments for select using (
  exists (select 1 from maintenance_requests r where r.id = request_id
          and (manages_unit(r.unit_id) or is_unit_tenant(r.unit_id))));
create policy mcomments_write on maintenance_comments for insert with check (
  author_id = auth.uid() and exists (select 1 from maintenance_requests r where r.id = request_id
          and (manages_unit(r.unit_id) or is_unit_tenant(r.unit_id))));
create policy mevents_read on maintenance_events for select using (
  exists (select 1 from maintenance_requests r where r.id = request_id
          and (manages_unit(r.unit_id) or is_unit_tenant(r.unit_id))));
create policy mevents_owner_write on maintenance_events for insert with check (
  exists (select 1 from maintenance_requests r where r.id = request_id and manages_unit(r.unit_id)));

-- Announcements: tenants see published ones for their property / their unit
create policy ann_owner on announcements for all using (owns_property(property_id)) with check (owns_property(property_id));
create policy ann_tenant on announcements for select
  using (can_view_announcement(id));
create policy annunits_owner on announcement_units for all
  using (owns_announcement(announcement_id))
  with check (owns_announcement(announcement_id));

-- Notifications: own only. Inserts happen inside security definer functions.
create policy notif_read   on notifications for select using (recipient_id = auth.uid());
create policy notif_update on notifications for update using (recipient_id = auth.uid());

-- =====================================================================
-- SIGNUP FLOW FUNCTIONS (call with supabase.rpc)
-- =====================================================================

-- Landlord signup step: create property + all units in one transaction.
create or replace function create_property(
  p_name text, p_street text, p_city text, p_province text,
  p_type property_type, p_unit_labels text[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if coalesce(array_length(p_unit_labels, 1), 0) = 0 then raise exception 'at_least_one_unit_required'; end if;

  insert into properties (owner_id, name, street_address, city, province, property_type)
  values (auth.uid(), p_name, p_street, p_city, p_province, p_type)
  returning id into v_id;

  insert into units (property_id, label)
  select v_id, trim(l) from unnest(p_unit_labels) as l;

  return v_id;
end $$;

-- "Quick add": generate_unit_labels(3, 4) -> {1A,1B,1C,1D,2A,...,3D}
create or replace function generate_unit_labels(p_floors int, p_per_floor int) returns text[]
language sql immutable as $$
  select array_agg(f::text || chr(64 + n) order by f, n)
  from generate_series(1, p_floors) f, generate_series(1, p_per_floor) n $$;

-- ---------- TENANT JOINS / LANDLORD INVITES -------------------------
-- Errors raised: invalid_invite_code, invite_already_used, invite_revoked,
--                invite_expired, invite_email_mismatch, unit_not_vacant, not_allowed

-- Preview a code before signup. If the invite is locked to an email,
--    the email typed at signup must match.

create or replace function preview_invite(p_code text, p_email text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_inv unit_invites; v jsonb;
begin
  select * into v_inv from unit_invites where code = upper(trim(p_code));
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_invite_code'); end if;
  if v_inv.redeemed_at is not null then return jsonb_build_object('ok', false, 'error', 'invite_already_used'); end if;
  if v_inv.revoked_at  is not null then return jsonb_build_object('ok', false, 'error', 'invite_revoked'); end if;
  if v_inv.expires_at  <  now()    then return jsonb_build_object('ok', false, 'error', 'invite_expired'); end if;
  if v_inv.invitee_email is not null
     and lower(trim(coalesce(p_email, ''))) <> lower(v_inv.invitee_email) then
    return jsonb_build_object('ok', false, 'error', 'invite_email_mismatch');
  end if;

  select jsonb_build_object(
    'ok', true,
    'unit_label',       u.label,
    'property_name',    p.name,
    'street_address',   p.street_address,
    'city',             p.city,
    'monthly_rent',     t.monthly_rent,
    'due_day',          t.due_day,
    'start_date',       l.start_date,
    'security_deposit', l.security_deposit,
    'advance_rent',     l.advance_rent,
    'charges', coalesce((
        select jsonb_agg(jsonb_build_object('name', c.name, 'mode', c.mode, 'fixed_amount', c.fixed_amount)
                         order by c.name)
          from lease_charges c where c.lease_id = l.id and c.active), '[]'::jsonb)
  ) into v
  from leases l
  join units u      on u.id = l.unit_id
  join properties p on p.id = u.property_id
  join lateral (select monthly_rent, due_day from lease_terms
                 where lease_id = l.id order by effective_from desc limit 1) t on true
  where l.id = v_inv.lease_id;

  return coalesce(v, jsonb_build_object('ok', false, 'error', 'invalid_invite_code'));
end $$;

revoke execute on function preview_invite(text, text) from public;
grant  execute on function preview_invite(text, text) to anon, authenticated;

-- Redeeming: same as before, plus the email lock
create or replace function redeem_invite(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_inv unit_invites; v_lease leases; v_owner uuid; v_prop uuid; v_bill uuid; v_email text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_inv from unit_invites where code = upper(trim(p_code)) for update;
  if not found                     then raise exception 'invalid_invite_code'; end if;
  if v_inv.redeemed_at is not null then raise exception 'invite_already_used'; end if;
  if v_inv.revoked_at  is not null then raise exception 'invite_revoked'; end if;
  if v_inv.expires_at  <  now()    then raise exception 'invite_expired'; end if;

  if v_inv.invitee_email is not null then
    select email into v_email from auth.users where id = auth.uid();
    if lower(coalesce(v_email, '')) <> lower(v_inv.invitee_email) then
      raise exception 'invite_email_mismatch';
    end if;
  end if;

  update leases set tenant_id = auth.uid(), status = 'active'
   where id = v_inv.lease_id and tenant_id is null and status = 'pending'
   returning * into v_lease;
  if not found then raise exception 'invite_already_used'; end if;

  update unit_invites set redeemed_by = auth.uid(), redeemed_at = now() where id = v_inv.id;

  if v_lease.security_deposit + v_lease.advance_rent > 0 then
    insert into bills (lease_id, bill_type, billing_period, due_date, created_by)
    values (v_lease.id, 'move_in', date_trunc('month', v_lease.start_date)::date, current_date, v_inv.created_by)
    returning id into v_bill;

    if v_lease.security_deposit > 0 then
      insert into bill_items (bill_id, description, category, amount, sort_order)
      values (v_bill, 'Security deposit', 'deposit', v_lease.security_deposit, 1);
    end if;
    if v_lease.advance_rent > 0 then
      insert into bill_items (bill_id, description, category, amount, sort_order)
      values (v_bill, 'Advance rent', 'advance_rent', v_lease.advance_rent, 2);
    end if;
  end if;

  select p.owner_id, p.id into v_owner, v_prop
    from units u join properties p on p.id = u.property_id where u.id = v_lease.unit_id;

  insert into notifications (recipient_id, type, title, body, property_id, unit_id)
  select v_owner, 'tenant_joined', 'Tenant joined',
         pr.first_name || ' ' || pr.last_name || ' joined ' || un.label || '.', v_prop, v_lease.unit_id
    from profiles pr, units un where pr.id = auth.uid() and un.id = v_lease.unit_id;

  return v_lease.id;
end $$;

-- Add Tenant: create the pending lease, its terms, charges and the invite in one go.

create or replace function create_lease_with_invite(
  p_unit uuid, p_start date, p_monthly_rent numeric, p_due_day smallint,
  p_security_deposit numeric default 0, p_advance_rent numeric default 0,
  p_charges jsonb default '[]'::jsonb,
  p_invitee_name text default null, p_invitee_email text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_lease uuid; v_invite uuid; v_code text; v_expires timestamptz;
begin
  if not manages_unit(p_unit) then raise exception 'not_allowed'; end if;
  if p_monthly_rent is null or p_monthly_rent <= 0 then raise exception 'invalid_rent'; end if;
  if exists (select 1 from leases where unit_id = p_unit and status in ('pending', 'active')) then
    raise exception 'unit_not_vacant';
  end if;

  insert into leases (unit_id, start_date, security_deposit, advance_rent)
  values (p_unit, p_start, coalesce(p_security_deposit, 0), coalesce(p_advance_rent, 0))
  returning id into v_lease;

  insert into lease_terms (lease_id, effective_from, monthly_rent, due_day, created_by)
  values (v_lease, date_trunc('month', p_start)::date, p_monthly_rent, p_due_day, auth.uid());

  insert into lease_charges (lease_id, name, category, mode, fixed_amount)
  select v_lease, trim(c->>'name'), (c->>'category')::charge_category, (c->>'mode')::charge_mode,
         nullif(c->>'fixed_amount', '')::numeric
    from jsonb_array_elements(coalesce(p_charges, '[]'::jsonb)) c;

  insert into unit_invites (lease_id, invitee_name, invitee_email, created_by)
  values (v_lease, nullif(trim(p_invitee_name), ''), nullif(lower(trim(p_invitee_email)), ''), auth.uid())
  returning id, code, expires_at into v_invite, v_code, v_expires;

  -- Vacant units show this rent in the table
  update units set listed_rent = p_monthly_rent where id = p_unit;

  return jsonb_build_object('lease_id', v_lease, 'invite_id', v_invite, 'code', v_code, 'expires_at', v_expires);
end $$;

-- Revoke an unused invite. The code stops working and the unit is vacant again.
create or replace function revoke_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_inv unit_invites;
begin
  select * into v_inv from unit_invites where id = p_invite for update;
  if not found or not manages_lease(v_inv.lease_id) then raise exception 'not_allowed'; end if;
  if v_inv.redeemed_at is not null then raise exception 'invite_already_used'; end if;

  update unit_invites set revoked_at = coalesce(revoked_at, now()) where id = p_invite;
  update leases set status = 'ended' where id = v_inv.lease_id and status = 'pending';
end $$;

-- Remove a tenant. The lease ends today. Bills and payments stay on record.
create or replace function remove_tenant(p_lease uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_lease leases;
begin
  select * into v_lease from leases where id = p_lease for update;
  if not found or not manages_lease(p_lease) then raise exception 'not_allowed'; end if;
  if v_lease.status <> 'active' then raise exception 'lease_not_active'; end if;

  update leases
     set status = 'ended', end_date = greatest(current_date, v_lease.start_date)
   where id = p_lease;
end $$;

-- Everything the Units and invites table needs, one row per unit.
create or replace function landlord_units(p_property uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not owns_property(p_property) then raise exception 'not_allowed'; end if;

  return coalesce((
    select jsonb_agg(to_jsonb(r))
    from (
      select u.id as unit_id, u.label, u.listed_rent,
             l.id as lease_id, l.status as lease_status,
             case when pr.id is not null then pr.first_name || ' ' || pr.last_name end as tenant_name,
             coalesce(
               (select t.monthly_rent from lease_terms t
                 where t.lease_id = l.id and t.effective_from <= current_date
                 order by t.effective_from desc limit 1),
               (select t.monthly_rent from lease_terms t
                 where t.lease_id = l.id order by t.effective_from asc limit 1),
               u.listed_rent) as rent,
             i.id as invite_id, i.code, i.expires_at, i.invitee_name
        from units u
        left join leases l on l.unit_id = u.id and l.status in ('pending', 'active')
        left join profiles pr on pr.id = l.tenant_id
        left join lateral (
          select * from unit_invites ui
           where ui.lease_id = l.id and ui.redeemed_at is null and ui.revoked_at is null
           order by ui.created_at desc limit 1
        ) i on true
       where u.property_id = p_property
    ) r
  ), '[]'::jsonb);
end $$;

-- =====================================================================
-- PAYMENT FUNCTIONS
-- =====================================================================
create or replace function _issue_receipt(p_payment uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_prop uuid; v_year int := extract(year from now())::int; v_no int; v_id uuid;
begin
  select pr.id into v_prop
    from payments pay join bills b on b.id = pay.bill_id join leases l on l.id = b.lease_id
    join units u on u.id = l.unit_id join properties pr on pr.id = u.property_id
   where pay.id = p_payment;

  insert into receipt_counters (property_id, year, last_number) values (v_prop, v_year, 1)
  on conflict (property_id, year) do update set last_number = receipt_counters.last_number + 1
  returning last_number into v_no;

  insert into receipts (payment_id, property_id, year, sequence_no)
  values (p_payment, v_prop, v_year, v_no) returning id into v_id;
  return v_id;
end $$;
revoke execute on function _issue_receipt(uuid) from public, anon, authenticated;

-- Landlord records cash received in person (confirmed immediately + receipt)
create or replace function record_cash_payment(
  p_bill uuid, p_amount numeric, p_received_on date, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_pay uuid; v_tenant uuid;
begin
  if not manages_bill(p_bill) then raise exception 'not_allowed'; end if;
  select l.tenant_id into v_tenant from bills b join leases l on l.id = b.lease_id where b.id = p_bill;

  insert into payments (bill_id, payer_id, amount, method, status, received_on, note, confirmed_by, confirmed_at)
  values (p_bill, v_tenant, p_amount, 'cash', 'confirmed', p_received_on, p_note, auth.uid(), now())
  returning id into v_pay;
  perform _issue_receipt(v_pay);
  return v_pay;
end $$;

-- Landlord confirms a tenant's pending cash notice
create or replace function confirm_payment(p_payment uuid, p_received_on date default current_date) returns void
language plpgsql security definer set search_path = public as $$
declare v payments;
begin
  select * into v from payments where id = p_payment for update;
  if not found or not manages_bill(v.bill_id) then raise exception 'not_allowed'; end if;
  if v.status <> 'pending' then raise exception 'payment_not_pending'; end if;

  update payments set status = 'confirmed', received_on = p_received_on,
         confirmed_by = auth.uid(), confirmed_at = now() where id = p_payment;
  perform _issue_receipt(p_payment);

  insert into notifications (recipient_id, type, title, body, payment_id, bill_id)
  values (v.payer_id, 'payment_received', 'Payment confirmed',
          'Your landlord confirmed your payment of PHP ' || v.amount || '.', p_payment, v.bill_id);
end $$;

-- Landlord rejects a cash notice (bill stays unpaid)
create or replace function reject_payment(p_payment uuid, p_reason rejection_reason, p_message text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v payments;
begin
  select * into v from payments where id = p_payment for update;
  if not found or not manages_bill(v.bill_id) then raise exception 'not_allowed'; end if;
  if v.status <> 'pending' then raise exception 'payment_not_pending'; end if;

  update payments set status = 'rejected', rejection_reason = p_reason, rejection_message = p_message where id = p_payment;

  insert into notifications (recipient_id, type, title, body, payment_id, bill_id)
  values (v.payer_id, 'cash_rejected', 'Cash notice rejected', coalesce(p_message, 'Please contact your landlord.'),
          p_payment, v.bill_id);
end $$;

-- =====================================================================
-- NOTIFICATION TRIGGERS
-- =====================================================================
create or replace function notify_cash_notice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.method = 'cash' and new.status = 'pending' then
    insert into notifications (recipient_id, type, title, body, payment_id, bill_id, unit_id, property_id)
    select p.owner_id, 'cash_notice', 'Cash payment notice',
           pr.first_name || ' says PHP ' || new.amount || ' in cash is ready.', new.id, new.bill_id, u.id, p.id
      from bills b join leases l on l.id = b.lease_id join units u on u.id = l.unit_id
      join properties p on p.id = u.property_id join profiles pr on pr.id = new.payer_id
     where b.id = new.bill_id;
  end if;
  return new;
end $$;
create trigger trg_cash_notice after insert on payments for each row execute function notify_cash_notice();

create or replace function on_new_repair_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into maintenance_events (request_id, status, actor_id, note)
  values (new.id, 'new', new.requested_by, 'Request received');

  insert into notifications (recipient_id, type, title, body, maintenance_request_id, unit_id, property_id)
  select p.owner_id, 'repair_request', 'New repair request', new.title, new.id, u.id, p.id
    from units u join properties p on p.id = u.property_id where u.id = new.unit_id;
  return new;
end $$;
create trigger trg_new_repair after insert on maintenance_requests
  for each row execute function on_new_repair_request();

-- =====================================================================
-- LANDLORD DASHBOARD + ROLES
-- =====================================================================

-- Everything the Overview page shows, in one call.
create or replace function landlord_overview(p_property uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_period    date := date_trunc('month', current_date)::date;
  v_total     numeric;
  v_paid      numeric;
  v_pending   int;
  v_repairs   int;
  v_vacant    int;
  v_attention jsonb;
  v_ann       jsonb;
begin
  if not owns_property(p_property) then raise exception 'not_allowed'; end if;

  -- Rent received this month = confirmed payments / total billed (monthly bills only)
  with b as (
    select coalesce((select sum(amount) from bill_items where bill_id = bl.id), 0) - bl.discount as total,
           coalesce((select sum(amount) from payments where bill_id = bl.id and status = 'confirmed'), 0) as paid
      from bills bl
      join leases l on l.id = bl.lease_id
      join units u  on u.id = l.unit_id
     where u.property_id = p_property
       and bl.bill_type = 'monthly'
       and bl.billing_period = v_period
  )
  select sum(total), sum(least(paid, total)) into v_total, v_paid from b;

  -- Cash notices waiting for the landlord
  select count(*) into v_pending
    from payments pay
    join bills bl  on bl.id = pay.bill_id
    join leases l  on l.id = bl.lease_id
    join units u   on u.id = l.unit_id
   where u.property_id = p_property and pay.method = 'cash' and pay.status = 'pending';

  -- Repairs not resolved yet
  select count(*) into v_repairs
    from maintenance_requests mr
    join units u on u.id = mr.unit_id
   where u.property_id = p_property and mr.status in ('new', 'assigned');

  -- Units with no active tenant
  select count(*) into v_vacant
    from units u
   where u.property_id = p_property
     and not exists (select 1 from leases l where l.unit_id = u.id and l.status = 'active');

  -- "Needs attention": cash notices, new repairs (urgent first), overdue bills
  select coalesce(jsonb_agg(to_jsonb(a) order by a.priority, a.sort_at desc), '[]'::jsonb)
    into v_attention
    from (
      select * from (
        select 'cash'::text as kind, pay.id as id, 1 as priority, pay.created_at as sort_at,
               u.label as unit_label,
               (pr.first_name || ' ' || pr.last_name)::text as person,
               pay.amount as amount, null::text as urgency, null::int as days_overdue, null::text as title
          from payments pay
          join bills bl on bl.id = pay.bill_id
          join leases l on l.id = bl.lease_id
          join units u  on u.id = l.unit_id
          join profiles pr on pr.id = pay.payer_id
         where u.property_id = p_property and pay.method = 'cash' and pay.status = 'pending'

        union all

        select 'repair'::text, mr.id, case when mr.urgency = 'urgent' then 2 else 4 end, mr.created_at,
               u.label, null::text, null::numeric, mr.urgency::text, null::int, mr.title
          from maintenance_requests mr
          join units u on u.id = mr.unit_id
         where u.property_id = p_property and mr.status = 'new'

        union all

        select 'overdue'::text, x.bill_id, 3, x.due_date::timestamptz,
               x.unit_label, x.person, x.balance, null::text, (current_date - x.due_date)::int, null::text
          from (
            select bl.id as bill_id, bl.due_date, u.label as unit_label,
                   (pr.first_name || ' ' || pr.last_name)::text as person,
                   (it.total - bl.discount - py.paid) as balance
              from bills bl
              join leases l on l.id = bl.lease_id
              join units u  on u.id = l.unit_id
              join profiles pr on pr.id = l.tenant_id
              cross join lateral (select coalesce(sum(amount), 0) as total from bill_items where bill_id = bl.id) it
              cross join lateral (select coalesce(sum(amount), 0) as paid
                                    from payments where bill_id = bl.id and status = 'confirmed') py
             where u.property_id = p_property
               and l.status = 'active'
               and bl.due_date < current_date
               and (it.total - bl.discount - py.paid) > 0
          ) x
      ) q
      order by priority, sort_at desc
      limit 6
    ) a;

  -- Three most recent announcements (sent or draft)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'title', a.title, 'audience', a.audience, 'status', a.status,
           'at', coalesce(a.published_at, a.created_at),
           'unit_count', (select count(*) from announcement_units au where au.announcement_id = a.id)
         ) order by coalesce(a.published_at, a.created_at) desc), '[]'::jsonb)
    into v_ann
    from (
      select * from announcements
       where property_id = p_property
       order by coalesce(published_at, created_at) desc
       limit 3
    ) a;

  return jsonb_build_object(
    'rent_received_pct', case when coalesce(v_total, 0) > 0 then round(100 * v_paid / v_total) end,
    'pending_cash', v_pending,
    'open_repairs', v_repairs,
    'vacant_units', v_vacant,
    'attention', v_attention,
    'announcements', v_ann
  );
end $$;

-- "Remind" button: sends the tenant an in-app notification about an unpaid bill
create or replace function send_rent_reminder(p_bill uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_unit uuid; v_prop uuid;
begin
  if not manages_bill(p_bill) then raise exception 'not_allowed'; end if;

  select l.tenant_id, u.id, u.property_id into v_tenant, v_unit, v_prop
    from bills b join leases l on l.id = b.lease_id join units u on u.id = l.unit_id
   where b.id = p_bill;
  if v_tenant is null then raise exception 'no_tenant'; end if;

  insert into notifications (recipient_id, type, title, body, bill_id, unit_id, property_id)
  values (v_tenant, 'rent_reminder', 'Rent reminder',
          'Your landlord sent a reminder about an unpaid bill.', p_bill, v_unit, v_prop);
end $$;

-- Who is a landlord / tenant. Derived, so it never goes out of date.
-- A person can be both.
create or replace view user_roles with (security_invoker = true) as
select
  p.id,
  p.first_name,
  p.last_name,
  r.is_landlord,
  r.is_tenant,
  case
    when r.is_landlord and r.is_tenant then 'both'
    when r.is_landlord then 'landlord'
    when r.is_tenant then 'tenant'
    else 'none'
  end as role
from profiles p
cross join lateral (
  select
    exists (select 1 from properties pr where pr.owner_id = p.id) as is_landlord,
    exists (select 1 from leases l where l.tenant_id = p.id and l.status = 'active') as is_tenant
) r;

-- =====================================================================
-- LANDLORD MAINTENANCE
-- =====================================================================

-- Everything the Maintenance page needs: technicians + requests with
-- photos and comments. Resolved requests are limited to the last 90 days.
create or replace function landlord_maintenance(p_property uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not owns_property(p_property) then raise exception 'not_allowed'; end if;

  return jsonb_build_object(
    'technicians', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'specialty', t.specialty)
                       order by t.name)
        from technicians t
       where t.property_id = p_property and t.active
    ), '[]'::jsonb),

    'requests', coalesce((
      select jsonb_agg(to_jsonb(r))
      from (
        select mr.id, u.label as unit_label, mr.category, mr.urgency, mr.title, mr.description,
               mr.status, mr.created_at, mr.resolved_at, mr.visit_at,
               mr.technician_id, tc.name as technician_name,
               mr.requested_by as requester_id,
               (pr.first_name || ' ' || pr.last_name) as requester_name,
               coalesce((select jsonb_agg(ph.storage_path order by ph.created_at)
                           from maintenance_photos ph where ph.request_id = mr.id), '[]'::jsonb) as photos,
               coalesce((select jsonb_agg(jsonb_build_object(
                                  'id', c.id, 'body', c.body, 'created_at', c.created_at,
                                  'author', case when c.author_id = mr.requested_by
                                                 then coalesce(pr.first_name || ' ' || pr.last_name, 'Tenant')
                                                 else 'Landlord' end)
                                order by c.created_at)
                           from maintenance_comments c where c.request_id = mr.id), '[]'::jsonb) as comments
          from maintenance_requests mr
          join units u on u.id = mr.unit_id
          left join technicians tc on tc.id = mr.technician_id
          left join profiles pr on pr.id = mr.requested_by
         where u.property_id = p_property
           and (mr.status <> 'resolved'
                or coalesce(mr.resolved_at, mr.updated_at) > now() - interval '90 days')
      ) r
    ), '[]'::jsonb)
  );
end $$;

-- "Update status": changes status, technician and visit time together,
-- records the timeline event, and notifies the tenant.
create or replace function update_maintenance(
  p_request    uuid,
  p_status     maintenance_status,
  p_technician uuid default null,
  p_visit_at   timestamptz default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v        maintenance_requests;
  v_tech   technicians;
  v_prop   uuid;
  v_note   text;
  v_body   text;
  v_changed boolean;
begin
  select * into v from maintenance_requests where id = p_request for update;
  if not found or not manages_unit(v.unit_id) then raise exception 'not_allowed'; end if;

  if p_status = 'assigned' and p_technician is null then
    raise exception 'technician_required';
  end if;

  if p_technician is not null then
    select t.* into v_tech
      from technicians t join units u on u.property_id = t.property_id
     where t.id = p_technician and u.id = v.unit_id;
    if not found then raise exception 'invalid_technician'; end if;
  end if;

  v_changed := v.status is distinct from p_status;

  update maintenance_requests
     set status        = p_status,
         technician_id = case when p_status = 'new' then null else p_technician end,
         visit_at      = case when p_status = 'new' then null else p_visit_at end,
         resolved_at   = case when p_status = 'resolved' then coalesce(v.resolved_at, now()) else null end
   where id = p_request;

  -- Timeline entry (the tenant sees these as "Progress")
  if v_changed or (p_status <> 'new' and p_technician is distinct from v.technician_id) then
    v_note := case p_status
                when 'assigned' then 'Assigned to ' || v_tech.name
                when 'resolved' then 'Resolved'
                else 'Reopened'
              end;
    insert into maintenance_events (request_id, status, actor_id, note)
    values (p_request, p_status, auth.uid(), v_note);
  end if;

  -- Tell the tenant when the status changed
  if v_changed then
    select property_id into v_prop from units where id = v.unit_id;
    v_body := v.title || ' was ' ||
              case p_status
                when 'assigned' then 'assigned to ' || v_tech.name
                when 'resolved' then 'resolved'
                else 'reopened'
              end || '.';
    insert into notifications (recipient_id, type, title, body, maintenance_request_id, unit_id, property_id)
    values (v.requested_by, 'repair_update', 'Repair request updated', v_body, p_request, v.unit_id, v_prop);
  end if;
end $$;

-- =====================================================================
-- LANDLORD PAYMENT DETAILS (GCash / Maya)
-- One row per landlord and method. Applies to all their properties.
-- =====================================================================

create table payment_accounts (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references profiles(id) on delete cascade,
  method         payment_method not null check (method in ('gcash', 'maya')),
  account_name   text not null check (length(trim(account_name)) >= 2),
  account_number text not null check (account_number ~ '^09[0-9]{9}$'),   -- PH mobile, 11 digits
  qr_path        text,                                                    -- object path in bucket "payment-qr"
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (owner_id, method)
);

create trigger trg_payment_accounts_updated before update on payment_accounts
  for each row execute function set_updated_at();

-- Is the logged-in user an active tenant of this landlord?
create or replace function is_tenant_of_landlord(p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from leases l
      join units u      on u.id = l.unit_id
      join properties p on p.id = u.property_id
     where p.owner_id = p_owner
       and l.tenant_id = auth.uid()
       and l.status = 'active') $$;

alter table payment_accounts enable row level security;

create policy payment_accounts_owner on payment_accounts for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Tenants can read their own landlord's details (and nobody else's)
create policy payment_accounts_tenant on payment_accounts for select
  using (is_tenant_of_landlord(owner_id));

-- =====================================================================
-- DELETE ACCOUNT / REMOVE TENANT (permanent; the app asks for confirmation)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Internal helpers (not callable from the app)
-- ---------------------------------------------------------------------

-- Delete one lease and everything that hangs off it:
-- receipts -> payments -> bills (+ items) -> the lease (+ terms, charges, invites)
create or replace function _delete_lease_records(p_lease uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from receipts
   where payment_id in (select pay.id from payments pay
                         join bills b on b.id = pay.bill_id
                        where b.lease_id = p_lease);
  delete from payments where bill_id in (select id from bills where lease_id = p_lease);
  delete from bills    where lease_id = p_lease;
  delete from leases   where id = p_lease;
end $$;

-- Delete a person completely: what they own, what they rent, and their login.
create or replace function _purge_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_prop uuid; v_lease uuid;
begin
  -- 1) Properties they own, with everything under them
  for v_prop in select id from properties where owner_id = p_user loop
    for v_lease in select l.id from leases l join units u on u.id = l.unit_id
                    where u.property_id = v_prop loop
      perform _delete_lease_records(v_lease);
    end loop;
    delete from receipts   where property_id = v_prop;
    delete from properties where id = v_prop;   -- units, repair requests, photos, comments,
                                                -- announcements and technicians go with it
  end loop;

  -- 2) Leases where they are the tenant
  for v_lease in select id from leases where tenant_id = p_user loop
    perform _delete_lease_records(v_lease);
  end loop;

  -- 3) Anything else they created or touched
  delete from receipts where payment_id in (select id from payments where payer_id = p_user);
  delete from payments              where payer_id    = p_user;
  delete from maintenance_requests  where requested_by = p_user;
  delete from maintenance_comments  where author_id   = p_user;
  delete from announcements         where author_id   = p_user;
  update maintenance_events set actor_id    = null where actor_id    = p_user;
  update payments           set confirmed_by = null where confirmed_by = p_user;

  -- 4) The login. Profile, preferences, notifications and payment details go with it.
  delete from auth.users where id = p_user;
end $$;

revoke execute on function _delete_lease_records(uuid) from public, anon, authenticated;
revoke execute on function _purge_user(uuid)           from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Delete my account (Settings -> Delete account)
-- ---------------------------------------------------------------------
create or replace function delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  perform _purge_user(auth.uid());
end $$;

-- ---------------------------------------------------------------------
-- Remove tenant (Units and invites): deletes the tenant's account and records.
--
-- Safeguard: if the person ALSO owns a property or rents from another landlord,
-- their account is kept (deleting it would destroy someone else's data). Only
-- their records with THIS landlord are deleted.
-- Returns {"account_deleted": true | false}.
-- ---------------------------------------------------------------------
create or replace function remove_tenant_and_account(p_lease uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v leases; v_tenant uuid; v_elsewhere boolean; v_lease uuid;
begin
  select * into v from leases where id = p_lease for update;
  if not found or not manages_lease(p_lease) then raise exception 'not_allowed'; end if;
  if v.status <> 'active' or v.tenant_id is null then raise exception 'lease_not_active'; end if;
  v_tenant := v.tenant_id;

  v_elsewhere :=
    exists (select 1 from properties where owner_id = v_tenant)
    or exists (select 1 from leases l
                 join units u      on u.id = l.unit_id
                 join properties p on p.id = u.property_id
                where l.tenant_id = v_tenant and p.owner_id <> auth.uid());

  if not v_elsewhere then
    perform _purge_user(v_tenant);
    return jsonb_build_object('account_deleted', true);
  end if;

  -- Keep the account. Delete only what belongs to this landlord.
  for v_lease in select l.id from leases l
                   join units u      on u.id = l.unit_id
                   join properties p on p.id = u.property_id
                  where l.tenant_id = v_tenant and p.owner_id = auth.uid() loop
    perform _delete_lease_records(v_lease);
  end loop;

  delete from maintenance_requests mr
   using units u, properties p
   where mr.unit_id = u.id and p.id = u.property_id
     and p.owner_id = auth.uid() and mr.requested_by = v_tenant;

  return jsonb_build_object('account_deleted', false);
end $$;

-- ---------------------------------------------------------------------
-- File lists. The app deletes these from Storage BEFORE calling the delete functions.
-- ---------------------------------------------------------------------
create or replace function my_file_paths() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object(
    'payment_qr', coalesce((
      select jsonb_agg(qr_path) from payment_accounts
       where owner_id = auth.uid() and qr_path is not null), '[]'::jsonb),
    'maintenance_photos', coalesce((
      select jsonb_agg(distinct ph.storage_path)
        from maintenance_photos ph
        join maintenance_requests mr on mr.id = ph.request_id
        join units u      on u.id = mr.unit_id
        join properties p on p.id = u.property_id
       where mr.requested_by = auth.uid() or p.owner_id = auth.uid()), '[]'::jsonb));
end $$;

create or replace function tenant_file_paths(p_lease uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v leases;
begin
  select * into v from leases where id = p_lease;
  if not found or not manages_lease(p_lease) then raise exception 'not_allowed'; end if;
  return jsonb_build_object(
    'maintenance_photos', coalesce((
      select jsonb_agg(ph.storage_path)
        from maintenance_photos ph
        join maintenance_requests mr on mr.id = ph.request_id
        join units u      on u.id = mr.unit_id
        join properties p on p.id = u.property_id
       where mr.requested_by = v.tenant_id and p.owner_id = auth.uid()), '[]'::jsonb));
end $$;

-- =====================================================================
-- ANNOUNCEMENTS
-- =====================================================================

-- BUG FIX: tenants must be able to see which units an announcement targets,
-- otherwise "Specific units" announcements are invisible to them.
create policy annunits_tenant on announcement_units for select
  using (is_unit_tenant(unit_id));

-- Create or edit an announcement, and (when posting) notify the tenants it targets.
--   p_id          null = new announcement, otherwise the one being edited
--   p_audience    'property' (every tenant) or 'units' (only p_unit_ids)
--   p_publish     true = post it now, false = keep it as a draft
-- Editing an announcement that is already posted keeps it posted (no new notifications).
create or replace function save_announcement(
  p_property     uuid,
  p_id           uuid,
  p_title        text,
  p_body         text,
  p_audience     announcement_audience,
  p_unit_ids     uuid[],
  p_notify_email boolean,
  p_publish      boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_body  text := trim(coalesce(p_body, ''));
  v_units uuid[] := coalesce(p_unit_ids, '{}');
  v_old   announcements;
  v_id    uuid;
  v_was_published boolean := false;
  v_now_published boolean := false;
begin
  if not owns_property(p_property) then raise exception 'not_allowed'; end if;

  if v_title = '' or v_body = '' or length(v_title) > 120 or length(v_body) > 2000 then
    raise exception 'invalid_announcement';
  end if;

  if p_audience = 'units' then
    if cardinality(v_units) = 0 then raise exception 'no_units_selected'; end if;
    if exists (select 1 from unnest(v_units) as uid
                where not exists (select 1 from units u
                                   where u.id = uid and u.property_id = p_property)) then
      raise exception 'invalid_units';
    end if;
  else
    v_units := '{}';
  end if;

  if p_id is null then
    insert into announcements (property_id, author_id, title, body, audience, notify_email, status, published_at)
    values (p_property, auth.uid(), v_title, v_body, p_audience, coalesce(p_notify_email, false),
            (case when p_publish then 'published' else 'draft' end)::announcement_status,
            case when p_publish then now() end)
    returning id into v_id;
    v_now_published := p_publish;
  else
    select * into v_old from announcements where id = p_id and property_id = p_property for update;
    if not found then raise exception 'not_allowed'; end if;

    v_was_published := v_old.status = 'published';
    v_now_published := p_publish and not v_was_published;

    update announcements
       set title        = v_title,
           body         = v_body,
           audience     = p_audience,
           notify_email = coalesce(p_notify_email, false),
           status       = (case when v_was_published or p_publish then 'published' else 'draft' end)::announcement_status,
           published_at = case when v_was_published then v_old.published_at
                               when p_publish then now()
                               else null end
     where id = p_id;
    v_id := p_id;
  end if;

  delete from announcement_units where announcement_id = v_id;
  insert into announcement_units (announcement_id, unit_id)
  select v_id, uid from unnest(v_units) as uid;

  -- Tell the tenants it is for
  if v_now_published then
    insert into notifications (recipient_id, type, title, body, property_id, announcement_id)
    select distinct l.tenant_id, 'announcement'::notification_type, v_title, left(v_body, 140), p_property, v_id
      from leases l
      join units u on u.id = l.unit_id
     where u.property_id = p_property
       and l.status = 'active'
       and l.tenant_id is not null
       and (p_audience = 'property' or u.id = any(v_units));
  end if;

  return v_id;
end $$;

-- =====================================================================
-- STORAGE: repair photos
--  Bucket "maintenance-photos" (private). Object path: {request_id}/{filename}
--  Flow: 1) app uploads the file to Storage  2) app inserts a row into
--  maintenance_photos with the same path.
--  Tenants upload to their own requests; the tenant and the landlord of
--  that unit can view. Limits: 5 MB, JPEG/PNG/WebP only.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('maintenance-photos', 'maintenance-photos', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- First folder of the path is the request id (null if it is not a valid uuid)
create or replace function photo_request_id(p_name text) returns uuid
language sql stable as $$
  select case when (storage.foldername(p_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (storage.foldername(p_name))[1]::uuid end $$;

create policy "repair photos: view" on storage.objects for select to authenticated
using (
  bucket_id = 'maintenance-photos'
  and exists (select 1 from public.maintenance_requests r
              where r.id = photo_request_id(name)
                and (public.manages_unit(r.unit_id) or public.is_unit_tenant(r.unit_id)))
);

create policy "repair photos: tenant upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'maintenance-photos'
  and exists (select 1 from public.maintenance_requests r
              where r.id = photo_request_id(name)
                and r.requested_by = auth.uid()
                and public.is_unit_tenant(r.unit_id))
);

create policy "repair photos: uploader delete" on storage.objects for delete to authenticated
using (bucket_id = 'maintenance-photos' and owner_id = auth.uid()::text);

-- ---------- STORAGE: payment QR images ------------------------------
-- Bucket "payment-qr" (private). Object path: {landlord_id}/{method}-{timestamp}.{ext}
-- The landlord manages their own folder. Their active tenants can view it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-qr', 'payment-qr', false, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- First folder of the path is the landlord's id (null if it is not a valid uuid)
create or replace function qr_owner_id(p_name text) returns uuid
language sql stable as $$
  select case when (storage.foldername(p_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (storage.foldername(p_name))[1]::uuid end $$;

create policy "payment qr: owner manage" on storage.objects for all to authenticated
  using (bucket_id = 'payment-qr' and public.qr_owner_id(name) = auth.uid())
  with check (bucket_id = 'payment-qr' and public.qr_owner_id(name) = auth.uid());

create policy "payment qr: tenant view" on storage.objects for select to authenticated
  using (bucket_id = 'payment-qr' and public.is_tenant_of_landlord(public.qr_owner_id(name)));

-- repair photos: a landlord can delete photos in their own units
-- A landlord must be able to delete repair photos in their own units
-- (so a removed tenant's photos can be cleaned up).
create policy "repair photos: landlord delete" on storage.objects for delete to authenticated
  using (bucket_id = 'maintenance-photos'
         and exists (select 1 from public.maintenance_requests r
                      where r.id = public.photo_request_id(name)
                        and public.manages_unit(r.unit_id)));