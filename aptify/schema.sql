-- =====================================================================
-- Aptify: complete Supabase schema (Postgres 15+), normalized to 3NF
--
-- This is the FINAL version. It already contains everything from the
-- earlier steps (initial schema, signup flow, landlord overview,
-- units and invites, maintenance, payment details, account deletion, announcements, rent ledger, receipt images, tenant home, announcements, repair requests and payments) plus the user_roles view.
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
  receipt_path       text,                    -- screenshot of the GCash/Maya receipt (bucket payment-receipts)
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

-- Is the logged-in user the landlord of this tenant?
create or replace function is_landlord_of_tenant(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from leases l
      join units u      on u.id = l.unit_id
      join properties p on p.id = u.property_id
     where l.tenant_id = p_tenant and p.owner_id = auth.uid()) $$;

-- Bill helpers: what is left to pay, and is a payment already waiting?
create or replace function bill_balance(p_bill uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount) from bill_items where bill_id = p_bill), 0)
       - coalesce((select discount from bills where id = p_bill), 0)
       - coalesce((select sum(amount) from payments where bill_id = p_bill and status = 'confirmed'), 0) $$;

create or replace function bill_has_pending(p_bill uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from payments where bill_id = p_bill and status = 'pending') $$;

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
create policy payments_tenant_submit on payments for insert with check (
  payer_id = auth.uid()
  and status = 'pending'
  and confirmed_by is null and confirmed_at is null
  and is_bill_tenant(bill_id)
  and not bill_has_pending(bill_id)
  and amount <= bill_balance(bill_id) + 0.005
  and (method = 'cash' or (method in ('gcash', 'maya') and receipt_path is not null))
);

create policy counters_owner on receipt_counters for select using (owns_property(property_id));
create policy receipts_owner  on receipts for select using (owns_property(property_id));
create policy receipts_tenant on receipts for select using (
  exists (select 1 from payments p where p.id = receipts.payment_id and p.payer_id = auth.uid()));

-- Maintenance
create policy tech_owner on technicians for all using (owns_property(property_id)) with check (owns_property(property_id));
create policy mreq_owner on maintenance_requests for all using (manages_unit(unit_id)) with check (manages_unit(unit_id));
create policy mreq_tenant_read   on maintenance_requests for select using (is_unit_tenant(unit_id));
create policy mreq_tenant_insert on maintenance_requests for insert with check (
  requested_by = auth.uid()
  and is_unit_tenant(unit_id)
  and status = 'new'
  and technician_id is null
  and visit_at is null
  and resolved_at is null
);

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

  -- Clean up revoked invites left by older versions of revoke_invite.
  update units set listed_rent = null
   where id = p_unit
     and exists (
       select 1 from leases l
       join unit_invites i on i.lease_id = l.id
       where l.unit_id = p_unit
         and l.status = 'pending'
         and i.revoked_at is not null
     );
  delete from leases l
   using unit_invites i
   where l.id = i.lease_id
     and l.unit_id = p_unit
     and l.status = 'pending'
     and i.revoked_at is not null;

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

  update units set listed_rent = null
   where id = (select unit_id from leases where id = v_inv.lease_id);
  delete from leases where id = v_inv.lease_id and status = 'pending';
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
  update units set listed_rent = null
   where id = v_lease.unit_id;
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
             -- Contact details. Email lives in auth.users, phone in profiles.
             case when pr.id is not null then (select au.email from auth.users au where au.id = pr.id) end as tenant_email,
             pr.phone as tenant_phone,
             coalesce(
               (select t.monthly_rent from lease_terms t
                 where t.lease_id = l.id and t.effective_from <= current_date
                 order by t.effective_from desc limit 1),
               (select t.monthly_rent from lease_terms t
                 where t.lease_id = l.id order by t.effective_from asc limit 1),
               u.listed_rent) as rent,
             i.id as invite_id, i.code, i.expires_at, i.invitee_name, i.invitee_email
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
  if new.status = 'pending' then
    insert into notifications (recipient_id, type, title, body, payment_id, bill_id, unit_id, property_id)
    select p.owner_id, 'cash_notice',
           case when new.method = 'cash' then 'Cash payment notice' else 'Payment receipt received' end,
           pr.first_name || case
             when new.method = 'cash' then ' says PHP ' || new.amount || ' in cash is ready.'
             else ' sent PHP ' || new.amount || ' by ' ||
                  (case new.method when 'gcash' then 'GCash' else 'Maya' end) || '. Review the receipt.'
           end,
           new.id, new.bill_id, u.id, p.id
      from bills b
      join leases l     on l.id = b.lease_id
      join units u      on u.id = l.unit_id
      join properties p on p.id = u.property_id
      join profiles pr  on pr.id = new.payer_id
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
  update units set listed_rent = null
   where id = (select unit_id from leases where id = p_lease);
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
       where mr.requested_by = auth.uid() or p.owner_id = auth.uid()), '[]'::jsonb),
    'payment_receipts', coalesce((
      select jsonb_agg(distinct pay.receipt_path)
        from payments pay
        join bills b      on b.id = pay.bill_id
        join leases l     on l.id = b.lease_id
        join units u      on u.id = l.unit_id
        join properties p on p.id = u.property_id
       where pay.receipt_path is not null
         and (pay.payer_id = auth.uid() or p.owner_id = auth.uid())), '[]'::jsonb));
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
       where mr.requested_by = v.tenant_id and p.owner_id = auth.uid()), '[]'::jsonb),
    'payment_receipts', coalesce((
      select jsonb_agg(pay.receipt_path)
        from payments pay
        join bills b      on b.id = pay.bill_id
        join leases l     on l.id = b.lease_id
        join units u      on u.id = l.unit_id
        join properties p on p.id = u.property_id
       where pay.payer_id = v.tenant_id and pay.receipt_path is not null
         and p.owner_id = auth.uid()), '[]'::jsonb));
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
-- RENT LEDGER
-- Everything the Rent ledger page needs for one month, plus pending move-in bills.
-- =====================================================================

create or replace function landlord_ledger(p_property uuid, p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_period  date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_year    int  := extract(year from now())::int;
  v_total   numeric;
  v_paid    numeric;
  v_pending int;
  v_repairs int;
  v_next    int;
  v_rows    jsonb;
begin
  if not owns_property(p_property) then raise exception 'not_allowed'; end if;

  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
  from (
    select l.id as lease_id, b.id as bill_id, b.bill_type, b.billing_period, b.due_date,
           (pr.first_name || ' ' || pr.last_name) as tenant_name,
           u.label as unit_label,
           (it.total - b.discount)            as total_due,
           py.paid,
           (it.total - b.discount - py.paid)  as balance,
           case when b.id is null                                         then 'unbilled'
                when pend.id is not null                                  then 'pending'
                when it.total > 0 and it.total - b.discount - py.paid <= 0 then 'paid'
                when b.due_date < current_date                            then 'overdue'
                when py.paid > 0                                          then 'partial'
                else 'unpaid' end as status,
           coalesce(pend.method::text, lp.method::text) as method,
           lp.received_on                     as paid_on,
           -- Lease has not started yet, so there is nothing to bill this month
           case when b.id is null
                 and l.start_date > (v_period + interval '1 month' - interval '1 day')::date
                then l.start_date end as starts_on,
           case when pend.id is not null then pend.amount else it.total - b.discount end as amount,
           case when pend.id is not null then jsonb_build_object(
                  'payment_id',   pend.id,
                  'amount',       pend.amount,
                  'method',       pend.method,
                  'reference_no', pend.reference_no,
                  'note',         pend.note,
                  'planned_date', pend.planned_date,
                  'receipt_path', pend.receipt_path,
                  'created_at',   pend.created_at) end as pending
      from leases l
      join units u      on u.id = l.unit_id
      join profiles pr  on pr.id = l.tenant_id
      left join bills b on b.lease_id = l.id
       and (b.billing_period = v_period
            -- A move-in bill stays on the ledger while it is unpaid, has a payment
            -- waiting, or was paid this month, even if its own month is later.
            or (b.bill_type = 'move_in' and (
                  bill_balance(b.id) > 0
                  or exists (
                       select 1 from payments x
                        where x.bill_id = b.id and x.status = 'pending')
                  or exists (
                       select 1 from payments x
                        where x.bill_id = b.id and x.status = 'confirmed'
                          and date_trunc('month', x.received_on)::date = v_period))))
      cross join lateral (select coalesce(sum(amount), 0) as total
                            from bill_items where bill_id = b.id) it
      cross join lateral (select coalesce(sum(amount), 0) as paid
                            from payments where bill_id = b.id and status = 'confirmed') py
      left join lateral (select * from payments
                          where bill_id = b.id and status = 'pending'
                          order by created_at desc limit 1) pend on true
      left join lateral (select method, received_on from payments
                          where bill_id = b.id and status = 'confirmed'
                          order by confirmed_at desc limit 1) lp on true
     where u.property_id = p_property
       and l.status = 'active'
  ) r;

  -- Rent received = confirmed / billed, monthly bills only
  with m as (
    select (select coalesce(sum(amount), 0) from bill_items where bill_id = bl.id) - bl.discount as total,
           (select coalesce(sum(amount), 0) from payments where bill_id = bl.id and status = 'confirmed') as paid
      from bills bl
      join leases l on l.id = bl.lease_id
      join units u  on u.id = l.unit_id
     where u.property_id = p_property and l.status = 'active'
       and bl.bill_type = 'monthly' and bl.billing_period = v_period)
  select sum(total), sum(least(paid, total)) into v_total, v_paid from m;

  select count(*) into v_pending
    from payments pay
    join bills bl on bl.id = pay.bill_id
    join leases l on l.id = bl.lease_id
    join units u  on u.id = l.unit_id
   where u.property_id = p_property and pay.status = 'pending';

  select count(*) into v_repairs
    from maintenance_requests mr join units u on u.id = mr.unit_id
   where u.property_id = p_property and mr.status in ('new', 'assigned');

  select coalesce((select last_number from receipt_counters
                    where property_id = p_property and year = v_year), 0) + 1 into v_next;

  return jsonb_build_object(
    'month', v_period,
    'rows', v_rows,
    'rent_received_pct', case when coalesce(v_total, 0) > 0 then round(100 * v_paid / v_total) end,
    'pending_count', v_pending,
    'open_repairs', v_repairs,
    'next_receipt_year', v_year,
    'next_receipt_number', v_next);
end $$;

-- =====================================================================
-- TENANT HOME SCREEN ("My Home"): only the logged-in tenant's own data
-- =====================================================================

create or replace function tenant_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_lease leases;
  v_prop  uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select l.* into v_lease
    from leases l
   where l.tenant_id = auth.uid() and l.status = 'active'
   order by l.created_at desc limit 1;

  if not found then return jsonb_build_object('has_lease', false); end if;

  select u.property_id into v_prop from units u where u.id = v_lease.unit_id;

  return jsonb_build_object(
    'has_lease', true,
    'unit_label', (select label from units where id = v_lease.unit_id),
    'property_name', (select name from properties where id = v_prop),

    -- The bill that is due next (earliest due date with something left to pay)
    'current_bill', (
      select to_jsonb(x) from (
        select b.id as bill_id, b.bill_type, b.billing_period, b.due_date,
               (it.total - b.discount)           as total_due,
               py.paid,
               (it.total - b.discount - py.paid) as balance,
               case when pend.id is not null then jsonb_build_object(
                      'payment_id', pend.id, 'amount', pend.amount,
                      'method', pend.method, 'created_at', pend.created_at) end as pending,
               case when pend.id is null then (
                      select jsonb_build_object(
                               'reason', rj.rejection_reason, 'message', rj.rejection_message,
                               'amount', rj.amount, 'method', rj.method)
                        from payments rj
                       where rj.bill_id = b.id and rj.status = 'rejected'
                       order by rj.updated_at desc limit 1) end as rejected
          from bills b
          cross join lateral (select coalesce(sum(amount), 0) as total
                                from bill_items where bill_id = b.id) it
          cross join lateral (select coalesce(sum(amount), 0) as paid
                                from payments where bill_id = b.id and status = 'confirmed') py
          left join lateral (select * from payments
                              where bill_id = b.id and status = 'pending'
                              order by created_at desc limit 1) pend on true
         where b.lease_id = v_lease.id
           and (it.total - b.discount - py.paid) > 0
         order by b.due_date asc
         limit 1
      ) x),

    'history', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.created_at desc)
        from (select pay.id, b.billing_period, b.bill_type, pay.amount, pay.method,
                     pay.status, pay.created_at
                from payments pay
                join bills b on b.id = pay.bill_id
               where b.lease_id = v_lease.id
               order by pay.created_at desc
               limit 4) h), '[]'::jsonb),

    'requests', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.created_at desc)
        from (select mr.id, mr.title, mr.category, mr.urgency, mr.status, mr.created_at
                from maintenance_requests mr
               where mr.unit_id = v_lease.unit_id and mr.requested_by = auth.uid()
               order by mr.created_at desc
               limit 3) q), '[]'::jsonb),

    'announcements', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.published_at desc)
        from (select an.id, an.title, an.published_at
                from announcements an
               where an.property_id = v_prop
                 and an.status = 'published'
                 and (an.audience = 'property'
                      or exists (select 1 from announcement_units au
                                  where au.announcement_id = an.id
                                    and au.unit_id = v_lease.unit_id))
               order by an.published_at desc
               limit 3) a), '[]'::jsonb)
  );
end $$;

-- Tenant Announcements page: what is meant for this tenant, with an unread flag
create or replace function tenant_announcements() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_lease leases;
  v_prop  uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select l.* into v_lease
    from leases l
   where l.tenant_id = auth.uid() and l.status = 'active'
   order by l.created_at desc limit 1;
  if not found then return '[]'::jsonb; end if;

  select u.property_id into v_prop from units u where u.id = v_lease.unit_id;

  return coalesce((
    select jsonb_agg(to_jsonb(a) order by a.published_at desc)
      from (
        select an.id, an.title, an.body, an.published_at,
               exists (select 1 from notifications n
                        where n.recipient_id = auth.uid()
                          and n.announcement_id = an.id
                          and n.read_at is null) as unread
          from announcements an
         where an.property_id = v_prop
           and an.status = 'published'
           and (an.audience = 'property'
                or exists (select 1 from announcement_units au
                            where au.announcement_id = an.id
                              and au.unit_id = v_lease.unit_id))
         order by an.published_at desc
         limit 100
      ) a), '[]'::jsonb);
end $$;

-- Tenant reopens their own resolved repair request
create or replace function tenant_reopen_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v maintenance_requests;
begin
  select * into v from maintenance_requests where id = p_request for update;
  if not found or v.requested_by <> auth.uid() or not is_unit_tenant(v.unit_id) then
    raise exception 'not_allowed';
  end if;
  if v.status <> 'resolved' then raise exception 'not_resolved'; end if;

  update maintenance_requests
     set status = 'new', technician_id = null, visit_at = null, resolved_at = null
   where id = p_request;

  insert into maintenance_events (request_id, status, actor_id, note)
  values (p_request, 'new', auth.uid(), 'Reopened');

  insert into notifications (recipient_id, type, title, body, maintenance_request_id, unit_id, property_id)
  select p.owner_id, 'repair_request', 'Repair request reopened', v.title, p_request, v.unit_id, p.id
    from units u join properties p on p.id = u.property_id
   where u.id = v.unit_id;
end $$;

-- =====================================================================
-- TENANT PAYMENTS
-- =====================================================================

-- The Payments page: the bill due next, and the payment history
create or replace function tenant_payments() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_lease leases; v_prop uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select l.* into v_lease from leases l
   where l.tenant_id = auth.uid() and l.status = 'active'
   order by l.created_at desc limit 1;
  if not found then return jsonb_build_object('has_lease', false); end if;

  select u.property_id into v_prop from units u where u.id = v_lease.unit_id;

  return jsonb_build_object(
    'has_lease', true,
    'unit_label', (select label from units where id = v_lease.unit_id),
    'property_name', (select name from properties where id = v_prop),

    'current_bill', (
      select to_jsonb(x) from (
        select b.id as bill_id, b.bill_type, b.billing_period, b.due_date,
               (it.total - b.discount)           as total_due,
               py.paid,
               (it.total - b.discount - py.paid) as balance,
               coalesce((select jsonb_agg(bi.description order by bi.sort_order)
                           from bill_items bi where bi.bill_id = b.id), '[]'::jsonb) as item_names,
               case when pend.id is not null then jsonb_build_object(
                      'payment_id', pend.id, 'amount', pend.amount,
                      'method', pend.method, 'created_at', pend.created_at) end as pending,
               case when pend.id is null then (
                      select jsonb_build_object(
                               'reason', rj.rejection_reason, 'message', rj.rejection_message,
                               'amount', rj.amount, 'method', rj.method)
                        from payments rj
                       where rj.bill_id = b.id and rj.status = 'rejected'
                       order by rj.updated_at desc limit 1) end as rejected
          from bills b
          cross join lateral (select coalesce(sum(amount), 0) as total
                                from bill_items where bill_id = b.id) it
          cross join lateral (select coalesce(sum(amount), 0) as paid
                                from payments where bill_id = b.id and status = 'confirmed') py
          left join lateral (select * from payments
                              where bill_id = b.id and status = 'pending'
                              order by created_at desc limit 1) pend on true
         where b.lease_id = v_lease.id and (it.total - b.discount - py.paid) > 0
         order by b.due_date asc
         limit 1
      ) x),

    'history', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.created_at desc)
        from (select pay.id, b.billing_period, b.bill_type, pay.amount, pay.method,
                     pay.status, pay.created_at, rc.receipt_no
                from payments pay
                join bills b on b.id = pay.bill_id
                left join receipts rc on rc.payment_id = pay.id
               where b.lease_id = v_lease.id
               order by pay.created_at desc
               limit 24) h), '[]'::jsonb)
  );
end $$;

-- The Pay page: one bill with its items, and the landlord's GCash / Maya details
--    p_bill null = the bill due next
create or replace function tenant_pay_info(p_bill uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_lease leases; v_bill uuid; v_prop uuid; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select l.* into v_lease from leases l
   where l.tenant_id = auth.uid() and l.status = 'active'
   order by l.created_at desc limit 1;
  if not found then raise exception 'no_lease'; end if;

  v_bill := p_bill;
  if v_bill is null then
    select b.id into v_bill from bills b
     where b.lease_id = v_lease.id and bill_balance(b.id) > 0
     order by b.due_date asc limit 1;
  end if;
  if v_bill is null then return jsonb_build_object('has_bill', false); end if;

  if not exists (select 1 from bills where id = v_bill and lease_id = v_lease.id) then
    raise exception 'not_allowed';
  end if;

  select u.property_id, p.owner_id into v_prop, v_owner
    from units u join properties p on p.id = u.property_id
   where u.id = v_lease.unit_id;

  return jsonb_build_object(
    'has_bill', true,
    'unit_label', (select label from units where id = v_lease.unit_id),
    'property_name', (select name from properties where id = v_prop),
    'bill', (
      select jsonb_build_object(
               'bill_id', b.id, 'bill_type', b.bill_type,
               'billing_period', b.billing_period, 'due_date', b.due_date,
               'discount', b.discount,
               'items', coalesce((select jsonb_agg(jsonb_build_object(
                                    'description', bi.description, 'amount', bi.amount)
                                    order by bi.sort_order)
                                    from bill_items bi where bi.bill_id = b.id), '[]'::jsonb),
               'total_due', (select coalesce(sum(amount), 0) from bill_items where bill_id = b.id) - b.discount,
               'paid', (select coalesce(sum(amount), 0) from payments where bill_id = b.id and status = 'confirmed'),
               'balance', bill_balance(b.id),
               'has_pending', bill_has_pending(b.id))
        from bills b where b.id = v_bill),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'method', pa.method, 'account_name', pa.account_name,
               'account_number', pa.account_number, 'qr_path', pa.qr_path)
               order by pa.method)
        from payment_accounts pa where pa.owner_id = v_owner), '[]'::jsonb)
  );
end $$;

-- An official receipt (only the tenant who paid can read it)
create or replace function tenant_receipt(p_payment uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select pay.id, pay.amount, pay.method, pay.reference_no, pay.received_on, pay.bill_id,
         b.billing_period, rc.receipt_no, rc.issued_at, u.label as unit_label, p.name as property_name
    into v
    from payments pay
    join bills b      on b.id = pay.bill_id
    join receipts rc  on rc.payment_id = pay.id
    join leases l     on l.id = b.lease_id
    join units u      on u.id = l.unit_id
    join properties p on p.id = u.property_id
   where pay.id = p_payment and pay.payer_id = auth.uid() and pay.status = 'confirmed';
  if not found then raise exception 'not_allowed'; end if;

  return jsonb_build_object(
    'receipt_no', v.receipt_no,
    'issued_at', v.issued_at,
    'tenant_name', (select first_name || ' ' || last_name from profiles where id = auth.uid()),
    'unit_label', v.unit_label,
    'property_name', v.property_name,
    'date_paid', coalesce(v.received_on, v.issued_at::date),
    'billing_period', v.billing_period,
    'method', v.method,
    'reference_no', v.reference_no,
    'items', coalesce((select jsonb_agg(jsonb_build_object('description', bi.description, 'amount', bi.amount)
                                       order by bi.sort_order)
                         from bill_items bi where bi.bill_id = v.bill_id), '[]'::jsonb),
    'total_paid', v.amount,
    'balance', bill_balance(v.bill_id));
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

-- ---------- STORAGE: receipt images ---------------------------------
-- Bucket "payment-receipts" (private). Object path: {tenant_id}/{timestamp}.{ext}
-- The tenant manages their own folder. Their landlord can view (and clean up) it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-receipts', 'payment-receipts', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function receipt_owner_id(p_name text) returns uuid
language sql stable as $$
  select case when (storage.foldername(p_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (storage.foldername(p_name))[1]::uuid end $$;

create policy "payment receipts: tenant manage" on storage.objects for all to authenticated
  using (bucket_id = 'payment-receipts' and public.receipt_owner_id(name) = auth.uid())
  with check (bucket_id = 'payment-receipts' and public.receipt_owner_id(name) = auth.uid());

create policy "payment receipts: landlord view" on storage.objects for select to authenticated
  using (bucket_id = 'payment-receipts' and public.is_landlord_of_tenant(public.receipt_owner_id(name)));

create policy "payment receipts: landlord delete" on storage.objects for delete to authenticated
  using (bucket_id = 'payment-receipts' and public.is_landlord_of_tenant(public.receipt_owner_id(name)));



  -- Migration: invite code throttling (apply once to an existing database)

-- ---------- INVITE CODE THROTTLING ----------------------------------
-- Failed code guesses are counted per caller. After 10 failures in 15 minutes the
-- caller is blocked until old attempts age out. Only failures are counted, so a
-- tenant who types the right code is never slowed down.
--
-- "Caller" is the client IP taken from the request headers (best effort: it is only
-- as trustworthy as the proxy in front of Supabase) and, for redeem_invite, the user id.
-- For stronger protection, also add CAPTCHA on signup and edge rate limits.
create table if not exists invite_attempts (
  id           bigint generated always as identity primary key,
  key          text not null,                       -- 'ip:1.2.3.4' or 'user:<uuid>'
  attempted_at timestamptz not null default now()
);
create index if not exists invite_attempts_key_time on invite_attempts (key, attempted_at);
create index if not exists invite_attempts_time     on invite_attempts (attempted_at);
alter table invite_attempts enable row level security;   -- no policies: only the functions below touch it
revoke all on invite_attempts from anon, authenticated;

create or replace function _request_ip() returns text
language plpgsql stable set search_path = public as $$
declare h json;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    h := null;
  end;
  return coalesce(
    nullif(trim(h->>'cf-connecting-ip'), ''),
    nullif(trim(h->>'x-real-ip'), ''),
    nullif(trim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''),
    'unknown'
  );
end $$;

create or replace function _invite_blocked(p_keys text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from invite_attempts
     where key = any(p_keys) and attempted_at > now() - interval '15 minutes'
     group by key having count(*) >= 10
  ) $$;

create or replace function _invite_fail(p_keys text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into invite_attempts (key) select unnest(p_keys);
  -- Housekeeping: now and then, drop attempts older than a day.
  if random() < 0.02 then
    delete from invite_attempts where attempted_at < now() - interval '1 day';
  end if;
end $$;

revoke execute on function _request_ip()            from public, anon, authenticated;
revoke execute on function _invite_blocked(text[])  from public, anon, authenticated;
revoke execute on function _invite_fail(text[])     from public, anon, authenticated;

-- Preview a code before signup. Every kind of bad code (unknown, used, revoked, expired)
-- gets the same answer, so a guesser learns nothing about which codes exist. If the invite
-- is locked to an email, the email typed at signup must match.
create or replace function preview_invite(p_code text, p_email text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_inv unit_invites; v jsonb; v_keys text[] := array['ip:' || _request_ip()];
begin
  if _invite_blocked(v_keys) then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  select * into v_inv from unit_invites where code = upper(trim(p_code));
  if not found
     or v_inv.redeemed_at is not null
     or v_inv.revoked_at  is not null
     or v_inv.expires_at  <  now() then
    perform _invite_fail(v_keys);
    return jsonb_build_object('ok', false, 'error', 'invalid_invite_code');
  end if;
  if v_inv.invitee_email is not null
     and lower(trim(coalesce(p_email, ''))) <> lower(v_inv.invitee_email) then
    perform _invite_fail(v_keys);
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

-- Redeeming. A bad code returns NULL instead of raising: a raise would roll back the
-- failed-attempt record, and the throttle would never fill up. Callers treat NULL as
-- "invalid code". A blocked caller gets the 'too_many_attempts' exception.
create or replace function redeem_invite(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_inv unit_invites; v_lease leases; v_owner uuid; v_prop uuid; v_bill uuid; v_email text;
  v_keys text[];
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  v_keys := array['ip:' || _request_ip(), 'user:' || auth.uid()::text];
  if _invite_blocked(v_keys) then raise exception 'too_many_attempts'; end if;

  select * into v_inv from unit_invites where code = upper(trim(p_code)) for update;
  if not found
     or v_inv.redeemed_at is not null
     or v_inv.revoked_at  is not null
     or v_inv.expires_at  <  now() then
    perform _invite_fail(v_keys);
    return null;
  end if;

  if v_inv.invitee_email is not null then
    select email into v_email from auth.users where id = auth.uid();
    if lower(coalesce(v_email, '')) <> lower(v_inv.invitee_email) then
      perform _invite_fail(v_keys);
      return null;
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

-- =====================================================================
-- 011_monthly_bills.sql
-- Creates the MONTHLY bills. Before this, only the move-in bill was ever
-- created (in redeem_invite), so the Rent ledger showed "Not billed" forever.
-- Safe to run more than once (create or replace + skips existing bills).
-- =====================================================================

-- Core worker. Makes one monthly bill per active lease for the given month,
-- skipping leases that already have one. NOT callable from the app.
create or replace function _generate_bills_for_period(p_period date, p_property uuid default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  r        record;
  v_bill   uuid;
  v_count  int := 0;
begin
  for r in
    select l.id as lease_id, l.tenant_id, l.unit_id, u.property_id, pr.owner_id,
           t.monthly_rent, t.due_day
      from leases l
      join units u       on u.id = l.unit_id
      join properties pr on pr.id = u.property_id
      -- the terms that apply to this month (latest one that has started)
      join lateral (select monthly_rent, due_day
                      from lease_terms
                     where lease_id = l.id and effective_from <= v_period
                     order by effective_from desc limit 1) t on true
     where l.status = 'active'
       and l.tenant_id is not null
       and (p_property is null or u.property_id = p_property)
       -- advance rent covers the first month, so billing starts the month after
       and v_period >= (date_trunc('month', l.start_date)
                        + case when l.advance_rent > 0 then interval '1 month'
                               else interval '0 month' end)::date
       and (l.end_date is null or v_period <= l.end_date)
       and not exists (select 1 from bills b
                        where b.lease_id = l.id
                          and b.bill_type = 'monthly'
                          and b.billing_period = v_period)
  loop
    v_bill := null;
    insert into bills (lease_id, bill_type, billing_period, due_date, created_by)
    values (r.lease_id, 'monthly', v_period, v_period + (r.due_day - 1), r.owner_id)
    on conflict (lease_id, billing_period, bill_type) do nothing
    returning id into v_bill;

    if v_bill is null then continue; end if;   -- someone else just made it

    insert into bill_items (bill_id, description, category, amount, sort_order)
    values (v_bill, 'Monthly rent', 'rent', r.monthly_rent, 1);

    -- Fixed recurring charges (association dues etc.). Variable charges
    -- (electricity, water) have no amount yet, so they are not added here.
    insert into bill_items (bill_id, description, category, amount, sort_order)
    select v_bill, c.name, c.category, c.fixed_amount,
           (1 + row_number() over (order by c.name))::smallint
      from lease_charges c
     where c.lease_id = r.lease_id and c.active and c.mode = 'fixed';

    insert into notifications (recipient_id, type, title, body, bill_id, unit_id, property_id)
    values (r.tenant_id, 'bill_issued', 'New bill',
            'Your bill for ' || to_char(v_period, 'FMMonth YYYY') || ' is ready.',
            v_bill, r.unit_id, r.property_id);

    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

revoke all on function _generate_bills_for_period(date, uuid) from public, anon, authenticated;

-- Landlord button: "Generate bills" for one month of their own property.
-- Returns how many bills were created.
create or replace function generate_monthly_bills(p_property uuid, p_month date default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_today  date := (now() at time zone 'Asia/Manila')::date;
  v_period date := date_trunc('month', coalesce(p_month, v_today))::date;
begin
  if not owns_property(p_property) then raise exception 'not_allowed'; end if;
  if v_period > date_trunc('month', v_today)::date then raise exception 'future_month'; end if;
  return _generate_bills_for_period(v_period, p_property);
end $$;

grant execute on function generate_monthly_bills(uuid, date) to authenticated;

-- Automatic version for every property (used by the schedule below).
create or replace function generate_all_monthly_bills() returns int
language sql security definer set search_path = public as $$
  select _generate_bills_for_period((now() at time zone 'Asia/Manila')::date, null) $$;

revoke all on function generate_all_monthly_bills() from public, anon, authenticated;



-- =====================================================================
-- 014_receipt_records.sql
-- Permanent receipt records for the landlord.
--
-- The original `receipts` rows are deleted with the tenant's lease and
-- payments. `receipt_records` is a self-contained snapshot (names, unit,
-- amount, items are copied in), so it survives when:
--   * the landlord removes a tenant
--   * a tenant deletes their account
-- It is only deleted if the landlord deletes their own account/property.
-- Safe to run more than once.
-- =====================================================================

create table if not exists receipt_records (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id) on delete cascade,
  year          int  not null,
  sequence_no   int  not null,
  receipt_no    text generated always as ('OR-' || year::text || '-' || lpad(sequence_no::text, 4, '0')) stored,
  issued_at     timestamptz not null default now(),

  -- Links that are allowed to disappear (kept for tracing while they exist)
  payment_id    uuid unique references payments(id) on delete set null,
  tenant_id     uuid references profiles(id) on delete set null,

  -- Snapshot: copied at the time of payment, never changes afterwards
  tenant_name   text not null,
  tenant_email  text,
  unit_label    text not null,
  property_name text not null,
  bill_type     bill_type not null,
  billing_period date not null,
  amount        numeric(12,2) not null,
  method        payment_method not null,
  reference_no  text,
  received_on   date not null,
  bill_total    numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  items         jsonb not null default '[]'::jsonb,

  unique (property_id, year, sequence_no)
);
create index if not exists receipt_records_property_idx on receipt_records(property_id, issued_at desc);

-- Landlords can only READ their own records. Nobody can edit or delete them
-- from the app; only the functions below write to this table.
alter table receipt_records enable row level security;
drop policy if exists receipt_records_owner on receipt_records;
create policy receipt_records_owner on receipt_records for select using (owns_property(property_id));
revoke insert, update, delete on receipt_records from anon, authenticated;

-- Issue a receipt AND save its permanent record.
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

  insert into receipt_records (
    property_id, year, sequence_no, issued_at, payment_id, tenant_id,
    tenant_name, tenant_email, unit_label, property_name,
    bill_type, billing_period, amount, method, reference_no, received_on,
    bill_total, balance_after, items)
  select pr.id, v_year, v_no, now(), pay.id, pay.payer_id,
         coalesce(nullif(trim(tp.first_name || ' ' || tp.last_name), ''), 'Unknown tenant'),
         au.email, u.label, pr.name,
         b.bill_type, b.billing_period, pay.amount, pay.method, pay.reference_no,
         coalesce(pay.received_on, current_date),
         (select coalesce(sum(bi.amount), 0) from bill_items bi where bi.bill_id = b.id) - b.discount,
         bill_balance(b.id),
         coalesce((select jsonb_agg(jsonb_build_object('description', bi.description, 'amount', bi.amount)
                                    order by bi.sort_order)
                     from bill_items bi where bi.bill_id = b.id), '[]'::jsonb)
    from payments pay
    join bills b       on b.id = pay.bill_id
    join leases l      on l.id = b.lease_id
    join units u       on u.id = l.unit_id
    join properties pr on pr.id = u.property_id
    left join profiles tp on tp.id = pay.payer_id
    left join auth.users au on au.id = pay.payer_id
   where pay.id = p_payment;

  return v_id;
end $$;
revoke execute on function _issue_receipt(uuid) from public, anon, authenticated;

-- Backfill: save a record for every receipt that already exists.
insert into receipt_records (
  property_id, year, sequence_no, issued_at, payment_id, tenant_id,
  tenant_name, tenant_email, unit_label, property_name,
  bill_type, billing_period, amount, method, reference_no, received_on,
  bill_total, balance_after, items)
select rc.property_id, rc.year, rc.sequence_no, rc.issued_at, pay.id, pay.payer_id,
       coalesce(nullif(trim(tp.first_name || ' ' || tp.last_name), ''), 'Unknown tenant'),
       au.email, u.label, pr.name,
       b.bill_type, b.billing_period, pay.amount, pay.method, pay.reference_no,
       coalesce(pay.received_on, rc.issued_at::date),
       (select coalesce(sum(bi.amount), 0) from bill_items bi where bi.bill_id = b.id) - b.discount,
       bill_balance(b.id),
       coalesce((select jsonb_agg(jsonb_build_object('description', bi.description, 'amount', bi.amount)
                                  order by bi.sort_order)
                   from bill_items bi where bi.bill_id = b.id), '[]'::jsonb)
  from receipts rc
  join payments pay  on pay.id = rc.payment_id
  join bills b       on b.id = pay.bill_id
  join leases l      on l.id = b.lease_id
  join units u       on u.id = l.unit_id
  join properties pr on pr.id = rc.property_id
  left join profiles tp on tp.id = pay.payer_id
  left join auth.users au on au.id = pay.payer_id
on conflict (property_id, year, sequence_no) do nothing;


-- 015_receipt_records_access.sql
-- Makes sure the app can READ receipt_records, and refreshes the API's table list.
-- Safe to run more than once.

grant select on receipt_records to authenticated;

-- Tells Supabase's API (PostgREST) to reload its schema so the new table is visible
notify pgrst, 'reload schema';


-- =====================================================================
-- 016_receipt_status.sql
-- Each receipt record now also remembers HOW the payment settled the bill:
--   fully_paid    the bill is fully paid and the money came on/before the due date
--   paid_overdue  the bill is fully paid but the money came after the due date
--   partial       some of the bill is still unpaid after this payment
-- Decided once when the receipt is issued, so it never changes later.
-- Safe to run more than once. (Do not re-run 014 after this: it would bring back
-- the older _issue_receipt without the status.)
-- =====================================================================

alter table receipt_records add column if not exists due_date  date;
alter table receipt_records add column if not exists pay_status text not null default 'fully_paid';
alter table receipt_records drop constraint if exists receipt_records_pay_status_check;
alter table receipt_records add constraint receipt_records_pay_status_check
  check (pay_status in ('fully_paid', 'partial', 'paid_overdue'));

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

  insert into receipt_records (
    property_id, year, sequence_no, issued_at, payment_id, tenant_id,
    tenant_name, tenant_email, unit_label, property_name,
    bill_type, billing_period, amount, method, reference_no, received_on,
    bill_total, balance_after, items, due_date, pay_status)
  select pr.id, v_year, v_no, now(), pay.id, pay.payer_id,
         coalesce(nullif(trim(tp.first_name || ' ' || tp.last_name), ''), 'Unknown tenant'),
         au.email, u.label, pr.name,
         b.bill_type, b.billing_period, pay.amount, pay.method, pay.reference_no,
         coalesce(pay.received_on, current_date),
         (select coalesce(sum(bi.amount), 0) from bill_items bi where bi.bill_id = b.id) - b.discount,
         bill_balance(b.id),
         coalesce((select jsonb_agg(jsonb_build_object('description', bi.description, 'amount', bi.amount)
                                    order by bi.sort_order)
                     from bill_items bi where bi.bill_id = b.id), '[]'::jsonb),
         b.due_date,
         case when bill_balance(b.id) > 0                              then 'partial'
              when coalesce(pay.received_on, current_date) > b.due_date then 'paid_overdue'
              else 'fully_paid' end
    from payments pay
    join bills b       on b.id = pay.bill_id
    join leases l      on l.id = b.lease_id
    join units u       on u.id = l.unit_id
    join properties pr on pr.id = u.property_id
    left join profiles tp on tp.id = pay.payer_id
    left join auth.users au on au.id = pay.payer_id
   where pay.id = p_payment;

  return v_id;
end $$;
revoke execute on function _issue_receipt(uuid) from public, anon, authenticated;

-- Backfill existing records (uses the balance as it was at the time of that payment)
update receipt_records rr
   set due_date = b.due_date,
       pay_status = case
         when rr.bill_total - coalesce((select sum(x.amount) from payments x
                                         where x.bill_id = b.id and x.status = 'confirmed'
                                           and x.confirmed_at <= pay.confirmed_at), 0) > 0 then 'partial'
         when rr.received_on > b.due_date then 'paid_overdue'
         else 'fully_paid' end
  from payments pay
  join bills b on b.id = pay.bill_id
 where pay.id = rr.payment_id and rr.due_date is null;

-- Records whose payment no longer exists: judge by the saved balance
update receipt_records
   set pay_status = case when balance_after > 0 then 'partial' else 'fully_paid' end
 where due_date is null and payment_id is null;


-- =====================================================================
-- 017_protect_receipt_records.sql
-- Receipt records can only be deleted when the landlord deletes their own
-- account (which deletes their property, and the records with it).
-- Nothing else can remove one: not removing a tenant, not a tenant deleting
-- their account, not any function or app query.
-- Safe to run more than once.
-- =====================================================================

create or replace function _protect_receipt_records() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- While the property still exists, the record must stay.
  -- When a property is deleted, its records are removed by the cascade and the
  -- property row is already gone by then, so this lets that through.
  if exists (select 1 from properties where id = old.property_id) then
    raise exception 'receipt_records_protected';
  end if;
  return old;
end $$;

drop trigger if exists protect_receipt_records on receipt_records;
create trigger protect_receipt_records
  before delete on receipt_records
  for each row execute function _protect_receipt_records();



  -- =====================================================================
-- HARDENING PATCH  (run once in the Supabase SQL editor, ideally on a
-- staging copy first, then re-test login, signup with an invite code,
-- paying a bill and confirming a payment)
-- =====================================================================

-- 1. FUNCTION PERMISSIONS ---------------------------------------------
-- Postgres lets everyone run a new function, and Supabase also grants it to anon
-- by default. Signed-out visitors should only be able to run preview_invite.
revoke execute on all functions in schema public from public, anon;

-- Everyone signed in keeps access (RLS policies and RPCs rely on it)...
grant execute on all functions in schema public to authenticated;

-- ...except the internal helpers that were deliberately locked down earlier.
revoke execute on function _issue_receipt(uuid)             from authenticated;
revoke execute on function _delete_lease_records(uuid)      from authenticated;
revoke execute on function _purge_user(uuid)                from authenticated;
revoke execute on function _request_ip()                    from authenticated;
revoke execute on function _invite_blocked(text[])          from authenticated;
revoke execute on function _invite_fail(text[])             from authenticated;
revoke execute on function _generate_bills_for_period(date, uuid) from authenticated;
revoke execute on function generate_all_monthly_bills()     from authenticated;

-- The one function signed-out visitors need (invite preview on the signup page).
grant execute on function preview_invite(text, text) to anon;

-- Future functions created in this schema start locked down.
alter default privileges in schema public revoke execute on functions from public, anon;

-- 2. RECEIPT SCREENSHOTS ----------------------------------------------
-- Before: tenants could delete or overwrite their own receipt at any time, even
-- after the landlord confirmed the payment. Now they can upload and view their
-- own receipts, and delete one only if no pending or confirmed payment uses it.
drop policy if exists "payment receipts: tenant manage" on storage.objects;

create policy "payment receipts: tenant view" on storage.objects for select to authenticated
  using (bucket_id = 'payment-receipts' and public.receipt_owner_id(name) = auth.uid());

create policy "payment receipts: tenant upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-receipts' and public.receipt_owner_id(name) = auth.uid());

create policy "payment receipts: tenant delete unused" on storage.objects for delete to authenticated
  using (
    bucket_id = 'payment-receipts'
    and public.receipt_owner_id(name) = auth.uid()
    and not exists (
      select 1 from public.payments p
       where p.receipt_path = storage.objects.name
         and p.status in ('pending', 'confirmed')
    )
  );



  -- =====================================================================
-- RENT LEDGER UPDATE  (run once in the Supabase SQL editor)
-- Adds peso totals to the ledger stat cards:
--   rent_expected / rent_collected  -> "72% - P36,000 of P50,000"
--   pending_amount                  -> money waiting for your confirmation
-- Removes open_repairs, which belongs on the Overview/Maintenance pages.
-- Safe to re-run. Existing permissions on the function are kept.
-- =====================================================================

create or replace function landlord_ledger(p_property uuid, p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_period  date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_year    int  := extract(year from now())::int;
  v_total   numeric;
  v_paid    numeric;
  v_pending int;
  v_pending_amt numeric;
  v_next    int;
  v_rows    jsonb;
begin
  if not owns_property(p_property) then raise exception 'not_allowed'; end if;

  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
  from (
    select l.id as lease_id, b.id as bill_id, b.bill_type, b.billing_period, b.due_date,
           (pr.first_name || ' ' || pr.last_name) as tenant_name,
           u.label as unit_label,
           (it.total - b.discount)            as total_due,
           py.paid,
           (it.total - b.discount - py.paid)  as balance,
           case when b.id is null                                         then 'unbilled'
                when pend.id is not null                                  then 'pending'
                when it.total > 0 and it.total - b.discount - py.paid <= 0 then 'paid'
                when b.due_date < current_date                            then 'overdue'
                when py.paid > 0                                          then 'partial'
                else 'unpaid' end as status,
           coalesce(pend.method::text, lp.method::text) as method,
           lp.received_on                     as paid_on,
           -- Lease has not started yet, so there is nothing to bill this month
           case when b.id is null
                 and l.start_date > (v_period + interval '1 month' - interval '1 day')::date
                then l.start_date end as starts_on,
           case when pend.id is not null then pend.amount else it.total - b.discount end as amount,
           case when pend.id is not null then jsonb_build_object(
                  'payment_id',   pend.id,
                  'amount',       pend.amount,
                  'method',       pend.method,
                  'reference_no', pend.reference_no,
                  'note',         pend.note,
                  'planned_date', pend.planned_date,
                  'receipt_path', pend.receipt_path,
                  'created_at',   pend.created_at) end as pending
      from leases l
      join units u      on u.id = l.unit_id
      join profiles pr  on pr.id = l.tenant_id
      left join bills b on b.lease_id = l.id
       and (b.billing_period = v_period
            -- A move-in bill stays on the ledger while it is unpaid, has a payment
            -- waiting, or was paid this month, even if its own month is later.
            or (b.bill_type = 'move_in' and (
                  bill_balance(b.id) > 0
                  or exists (
                       select 1 from payments x
                        where x.bill_id = b.id and x.status = 'pending')
                  or exists (
                       select 1 from payments x
                        where x.bill_id = b.id and x.status = 'confirmed'
                          and date_trunc('month', x.received_on)::date = v_period))))
      cross join lateral (select coalesce(sum(amount), 0) as total
                            from bill_items where bill_id = b.id) it
      cross join lateral (select coalesce(sum(amount), 0) as paid
                            from payments where bill_id = b.id and status = 'confirmed') py
      left join lateral (select * from payments
                          where bill_id = b.id and status = 'pending'
                          order by created_at desc limit 1) pend on true
      left join lateral (select method, received_on from payments
                          where bill_id = b.id and status = 'confirmed'
                          order by confirmed_at desc limit 1) lp on true
     where u.property_id = p_property
       and l.status = 'active'
  ) r;

  -- Rent received = confirmed / billed, monthly bills only
  with m as (
    select (select coalesce(sum(amount), 0) from bill_items where bill_id = bl.id) - bl.discount as total,
           (select coalesce(sum(amount), 0) from payments where bill_id = bl.id and status = 'confirmed') as paid
      from bills bl
      join leases l on l.id = bl.lease_id
      join units u  on u.id = l.unit_id
     where u.property_id = p_property and l.status = 'active'
       and bl.bill_type = 'monthly' and bl.billing_period = v_period)
  select sum(total), sum(least(paid, total)) into v_total, v_paid from m;

  select count(*), coalesce(sum(pay.amount), 0) into v_pending, v_pending_amt
    from payments pay
    join bills bl on bl.id = pay.bill_id
    join leases l on l.id = bl.lease_id
    join units u  on u.id = l.unit_id
   where u.property_id = p_property and pay.status = 'pending';

  select coalesce((select last_number from receipt_counters
                    where property_id = p_property and year = v_year), 0) + 1 into v_next;

  return jsonb_build_object(
    'month', v_period,
    'rows', v_rows,
    'rent_received_pct', case when coalesce(v_total, 0) > 0 then round(100 * v_paid / v_total) end,
    'rent_expected', coalesce(v_total, 0),
    'rent_collected', coalesce(v_paid, 0),
    'pending_count', v_pending,
    'pending_amount', v_pending_amt,
    'next_receipt_year', v_year,
    'next_receipt_number', v_next);
end $$;



-- =====================================================================
-- TENANT "UNPAID BILLS" UPDATE  (run once in the Supabase SQL editor)
-- tenant_payments() now returns:
--   current_bill  - this month's bill (the main card)
--   unpaid_bills  - bills from months that have already ended and still have a
--                   balance (partial or overdue), one entry per month, oldest first
-- The month rolls over at midnight Philippine time. Safe to re-run.
-- =====================================================================

create or replace function tenant_payments() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_lease leases; v_prop uuid; v_open jsonb;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_month date := date_trunc('month', now() at time zone 'Asia/Manila')::date;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select l.* into v_lease from leases l
   where l.tenant_id = auth.uid() and l.status = 'active'
   order by l.created_at desc limit 1;
  if not found then return jsonb_build_object('has_lease', false); end if;

  select u.property_id into v_prop from units u where u.id = v_lease.unit_id;

  -- Every bill that still has a balance, oldest month first. is_past = its month has ended.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.billing_period, x.due_date), '[]'::jsonb)
    into v_open
    from (
      select b.id as bill_id, b.bill_type, b.billing_period, b.due_date,
             (it.total - b.discount)           as total_due,
             py.paid,
             (it.total - b.discount - py.paid) as balance,
             coalesce((select jsonb_agg(bi.description order by bi.sort_order)
                         from bill_items bi where bi.bill_id = b.id), '[]'::jsonb) as item_names,
             case when pend.id is not null then jsonb_build_object(
                    'payment_id', pend.id, 'amount', pend.amount,
                    'method', pend.method, 'created_at', pend.created_at) end as pending,
             case when pend.id is null then (
                    select jsonb_build_object(
                             'reason', rj.rejection_reason, 'message', rj.rejection_message,
                             'amount', rj.amount, 'method', rj.method)
                      from payments rj
                     where rj.bill_id = b.id and rj.status = 'rejected'
                     order by rj.updated_at desc limit 1) end as rejected,
             (b.billing_period < v_month)              as is_past,
             greatest(v_today - b.due_date, 0)         as days_overdue
        from bills b
        cross join lateral (select coalesce(sum(amount), 0) as total
                              from bill_items where bill_id = b.id) it
        cross join lateral (select coalesce(sum(amount), 0) as paid
                              from payments where bill_id = b.id and status = 'confirmed') py
        left join lateral (select * from payments
                            where bill_id = b.id and status = 'pending'
                            order by created_at desc limit 1) pend on true
       where b.lease_id = v_lease.id and (it.total - b.discount - py.paid) > 0
    ) x;

  return jsonb_build_object(
    'has_lease', true,
    'unit_label', (select label from units where id = v_lease.unit_id),
    'property_name', (select name from properties where id = v_prop),

    -- This month's bill (or a later one): the main card
    'current_bill', (
      select e from jsonb_array_elements(v_open) with ordinality t(e, n)
       where not (e->>'is_past')::boolean
       order by n limit 1),

    -- Bills from months that have already ended, one entry per month, oldest first
    'unpaid_bills', coalesce((
      select jsonb_agg(e order by n)
        from jsonb_array_elements(v_open) with ordinality t(e, n)
       where (e->>'is_past')::boolean), '[]'::jsonb),

    'history', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.created_at desc)
        from (select pay.id, b.billing_period, b.bill_type, pay.amount, pay.method,
                     pay.status, pay.created_at, rc.receipt_no
                from payments pay
                join bills b on b.id = pay.bill_id
                left join receipts rc on rc.payment_id = pay.id
               where b.lease_id = v_lease.id
               order by pay.created_at desc
               limit 24) h), '[]'::jsonb)
  );
end $$;



-- =====================================================================
-- 021_rent_received.sql
-- "Rent received" on the Overview and the Rent ledger now shows the MONEY received
-- in the month (every confirmed payment, including move-in payments), not only a
-- percentage of monthly rent bills. Before, it showed "-" until monthly bills existed.
--
-- This replaces landlord_ledger and landlord_overview. landlord_ledger also keeps the
-- peso totals from your ledger update (rent_expected, rent_collected, pending_amount)
-- and everything from 012/018 (paid date, "Starts ..." status, move-in rows, Manila time).
-- Safe to run more than once.
-- =====================================================================

create or replace function ph_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Manila')::date $$;

create or replace function landlord_ledger(p_property uuid, p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_period  date := date_trunc('month', coalesce(p_month, ph_today()))::date;
  v_year    int  := extract(year from ph_today())::int;
  v_total   numeric;
  v_paid    numeric;
  v_pending int;
  v_pending_amt numeric;
  v_received numeric;
  v_repairs int;
  v_next    int;
  v_rows    jsonb;
begin
  if not owns_property(p_property) then raise exception 'not_allowed'; end if;

  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
  from (
    select l.id as lease_id, b.id as bill_id, b.bill_type, b.billing_period, b.due_date,
           (pr.first_name || ' ' || pr.last_name) as tenant_name,
           u.label as unit_label,
           (it.total - b.discount)            as total_due,
           py.paid,
           (it.total - b.discount - py.paid)  as balance,
           case when b.id is null                                         then 'unbilled'
                when pend.id is not null                                  then 'pending'
                when it.total > 0 and it.total - b.discount - py.paid <= 0 then 'paid'
                when b.due_date < ph_today()                            then 'overdue'
                when py.paid > 0                                          then 'partial'
                else 'unpaid' end as status,
           coalesce(pend.method::text, lp.method::text) as method,
           lp.received_on                     as paid_on,
           -- Lease has not started yet, so there is nothing to bill this month
           case when b.id is null
                 and l.start_date > (v_period + interval '1 month' - interval '1 day')::date
                then l.start_date end as starts_on,
           case when pend.id is not null then pend.amount else it.total - b.discount end as amount,
           case when pend.id is not null then jsonb_build_object(
                  'payment_id',   pend.id,
                  'amount',       pend.amount,
                  'method',       pend.method,
                  'reference_no', pend.reference_no,
                  'note',         pend.note,
                  'planned_date', pend.planned_date,
                  'receipt_path', pend.receipt_path,
                  'created_at',   pend.created_at) end as pending
      from leases l
      join units u      on u.id = l.unit_id
      join profiles pr  on pr.id = l.tenant_id
      left join bills b on b.lease_id = l.id
       and (b.billing_period = v_period
            -- A move-in bill stays on the ledger while it is unpaid, has a payment
            -- waiting, or was paid this month, even if its own month is later.
            or (b.bill_type = 'move_in' and (
                  bill_balance(b.id) > 0
                  or exists (
                       select 1 from payments x
                        where x.bill_id = b.id and x.status = 'pending')
                  or exists (
                       select 1 from payments x
                        where x.bill_id = b.id and x.status = 'confirmed'
                          and date_trunc('month', x.received_on)::date = v_period))))
      cross join lateral (select coalesce(sum(amount), 0) as total
                            from bill_items where bill_id = b.id) it
      cross join lateral (select coalesce(sum(amount), 0) as paid
                            from payments where bill_id = b.id and status = 'confirmed') py
      left join lateral (select * from payments
                          where bill_id = b.id and status = 'pending'
                          order by created_at desc limit 1) pend on true
      left join lateral (select method, received_on from payments
                          where bill_id = b.id and status = 'confirmed'
                          order by confirmed_at desc limit 1) lp on true
     where u.property_id = p_property
       and l.status = 'active'
  ) r;

  -- Rent received = confirmed / billed, monthly bills only
  with m as (
    select (select coalesce(sum(amount), 0) from bill_items where bill_id = bl.id) - bl.discount as total,
           (select coalesce(sum(amount), 0) from payments where bill_id = bl.id and status = 'confirmed') as paid
      from bills bl
      join leases l on l.id = bl.lease_id
      join units u  on u.id = l.unit_id
     where u.property_id = p_property and l.status = 'active'
       and bl.bill_type = 'monthly' and bl.billing_period = v_period)
  select sum(total), sum(least(paid, total)) into v_total, v_paid from m;

  -- Money actually received in this month: confirmed payments of any kind
  -- (monthly rent as well as the move-in bill), by the date they were received.
  select coalesce(sum(pay.amount), 0) into v_received
    from payments pay
    join bills bl on bl.id = pay.bill_id
    join leases l on l.id = bl.lease_id
    join units u  on u.id = l.unit_id
   where u.property_id = p_property
     and pay.status = 'confirmed'
     and date_trunc('month', coalesce(pay.received_on, (pay.confirmed_at at time zone 'Asia/Manila')::date))::date = v_period;

  select count(*), coalesce(sum(pay.amount), 0) into v_pending, v_pending_amt
    from payments pay
    join bills bl on bl.id = pay.bill_id
    join leases l on l.id = bl.lease_id
    join units u  on u.id = l.unit_id
   where u.property_id = p_property and pay.status = 'pending';

  select count(*) into v_repairs
    from maintenance_requests mr join units u on u.id = mr.unit_id
   where u.property_id = p_property and mr.status in ('new', 'assigned');

  select coalesce((select last_number from receipt_counters
                    where property_id = p_property and year = v_year), 0) + 1 into v_next;

  return jsonb_build_object(
    'month', v_period,
    'rows', v_rows,
    'rent_received_pct', case when coalesce(v_total, 0) > 0 then round(100 * v_paid / v_total) end,
    'rent_expected', coalesce(v_total, 0),
    'rent_collected', coalesce(v_paid, 0),
    'rent_received', v_received,
    'pending_count', v_pending,
    'pending_amount', v_pending_amt,
    'open_repairs', v_repairs,
    'next_receipt_year', v_year,
    'next_receipt_number', v_next);
end $$;

create or replace function landlord_overview(p_property uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_period    date := date_trunc('month', ph_today())::date;
  v_total     numeric;
  v_paid      numeric;
  v_pending   int;
  v_received  numeric;
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

  -- Money actually received in this month: confirmed payments of any kind
  -- (monthly rent as well as the move-in bill), by the date they were received.
  select coalesce(sum(pay.amount), 0) into v_received
    from payments pay
    join bills bl on bl.id = pay.bill_id
    join leases l on l.id = bl.lease_id
    join units u  on u.id = l.unit_id
   where u.property_id = p_property
     and pay.status = 'confirmed'
     and date_trunc('month', coalesce(pay.received_on, (pay.confirmed_at at time zone 'Asia/Manila')::date))::date = v_period;

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
               x.unit_label, x.person, x.balance, null::text, (ph_today() - x.due_date)::int, null::text
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
               and bl.due_date < ph_today()
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
    'rent_received', v_received,
    'pending_cash', v_pending,
    'open_repairs', v_repairs,
    'vacant_units', v_vacant,
    'attention', v_attention,
    'announcements', v_ann
  );
end $$;



-- =====================================================================
-- 024_unpaid_bills_review.sql
-- Replaces landlord_unpaid_bills (from 022) so each row also carries the lease and the details of a
-- payment waiting for review, which lets you press "Review payment" right in the Unpaid bills table.
-- Powers the "Unpaid bills" table in the landlord's Rent ledger: every tenant's bill
-- (any month, including move-in bills) that still has a balance. Status:
--   pending  a payment was sent and is waiting for you to confirm
--   overdue  the due date has passed (Philippine time)
--   partial  some of it is paid
--   unpaid   nothing paid yet, not due yet
-- Safe to run more than once.
-- =====================================================================

create or replace function landlord_unpaid_bills(p_property uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not owns_property(p_property) then raise exception 'not_allowed'; end if;

  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.due_date, x.tenant_name)
      from (
        select l.id as lease_id, b.id as bill_id, b.bill_type, b.billing_period, b.due_date,
               (pr.first_name || ' ' || pr.last_name) as tenant_name,
               u.label as unit_label,
               (it.total - b.discount)               as total_due,
               py.paid,
               (it.total - b.discount - py.paid)     as balance,
               case when pend.id is not null            then 'pending'
                    when b.due_date < ph_today()        then 'overdue'
                    when py.paid > 0                    then 'partial'
                    else 'unpaid' end                   as status,
               greatest(ph_today() - b.due_date, 0)     as days_overdue,
               case when pend.id is not null then jsonb_build_object(
                      'payment_id',   pend.id,
                      'amount',       pend.amount,
                      'method',       pend.method,
                      'reference_no', pend.reference_no,
                      'note',         pend.note,
                      'planned_date', pend.planned_date,
                      'receipt_path', pend.receipt_path,
                      'created_at',   pend.created_at) end as pending
          from bills b
          join leases l     on l.id = b.lease_id
          join units u      on u.id = l.unit_id
          join profiles pr  on pr.id = l.tenant_id
          cross join lateral (select coalesce(sum(amount), 0) as total
                                from bill_items where bill_id = b.id) it
          cross join lateral (select coalesce(sum(amount), 0) as paid
                                from payments where bill_id = b.id and status = 'confirmed') py
          left join lateral (select * from payments
                              where bill_id = b.id and status = 'pending'
                              order by created_at desc limit 1) pend on true
         where u.property_id = p_property
           and l.status = 'active'
           and it.total > 0
           and it.total - b.discount - py.paid > 0
      ) x
  ), '[]'::jsonb);
end $$;


-- =====================================================================
-- 025_create_bills_with_variables.sql
-- Powers the new "Create bills" screen in the Rent ledger:
--   landlord_bill_preview  lists the tenants who still need this month's bill, with their
--                          rent, their FIXED charges (read-only) and their VARIABLE charges
--                          (the landlord types the amounts).
--   create_monthly_bills   creates those bills: rent + fixed charges + the variable amounts
--                          that were entered. A variable amount left blank or 0 is skipped.
-- Who needs a bill is decided exactly like the old Generate bills button: active lease,
-- already started (advance rent covers the first month), not ended, no bill for that month yet.
-- Safe to run more than once.
-- =====================================================================

create or replace function landlord_bill_preview(p_property uuid, p_month date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_period date := date_trunc('month', coalesce(p_month, ph_today()))::date;
begin
  if not owns_property(p_property) then raise exception 'not_allowed'; end if;
  if v_period > date_trunc('month', ph_today())::date then raise exception 'future_month'; end if;

  return jsonb_build_object(
    'month', v_period,
    'bills', coalesce((
      select jsonb_agg(jsonb_build_object(
               'lease_id',    l.id,
               'tenant_name', tp.first_name || ' ' || tp.last_name,
               'unit_label',  u.label,
               'due_date',    v_period + (t.due_day - 1),
               'rent',        t.monthly_rent,
               'fixed', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'charge_id', c.id, 'name', c.name,
                            'category',  c.category, 'amount', c.fixed_amount) order by c.name)
                     from lease_charges c
                    where c.lease_id = l.id and c.active and c.mode = 'fixed'), '[]'::jsonb),
               'variable', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'charge_id', c.id, 'name', c.name, 'category', c.category) order by c.name)
                     from lease_charges c
                    where c.lease_id = l.id and c.active and c.mode = 'variable'), '[]'::jsonb)
             ) order by u.label)
        from leases l
        join units u    on u.id = l.unit_id
        join profiles tp on tp.id = l.tenant_id
        join lateral (select monthly_rent, due_day
                        from lease_terms
                       where lease_id = l.id and effective_from <= v_period
                       order by effective_from desc limit 1) t on true
       where l.status = 'active'
         and l.tenant_id is not null
         and u.property_id = p_property
         and v_period >= (date_trunc('month', l.start_date)
                          + case when l.advance_rent > 0 then interval '1 month'
                                 else interval '0 month' end)::date
         and (l.end_date is null or v_period <= l.end_date)
         and not exists (select 1 from bills b
                          where b.lease_id = l.id
                            and b.bill_type = 'monthly'
                            and b.billing_period = v_period)
    ), '[]'::jsonb)
  );
end $$;

-- p_entries looks like:
--   [ { "lease_id": "...", "variables": [ { "charge_id": "...", "amount": 350 }, ... ] }, ... ]
create or replace function create_monthly_bills(p_property uuid, p_month date, p_entries jsonb default '[]'::jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_period date := date_trunc('month', coalesce(p_month, ph_today()))::date;
  r        record;
  c        record;
  e        jsonb;
  v        jsonb;
  v_bill   uuid;
  v_count  int := 0;
  v_sort   int;
  v_amount numeric;
begin
  if not owns_property(p_property) then raise exception 'not_allowed'; end if;
  if v_period > date_trunc('month', ph_today())::date then raise exception 'future_month'; end if;

  for r in
    select l.id as lease_id, l.tenant_id, l.unit_id, u.property_id, pr.owner_id,
           t.monthly_rent, t.due_day
      from leases l
      join units u       on u.id = l.unit_id
      join properties pr on pr.id = u.property_id
      join lateral (select monthly_rent, due_day
                      from lease_terms
                     where lease_id = l.id and effective_from <= v_period
                     order by effective_from desc limit 1) t on true
     where l.status = 'active'
       and l.tenant_id is not null
       and u.property_id = p_property
       and v_period >= (date_trunc('month', l.start_date)
                        + case when l.advance_rent > 0 then interval '1 month'
                               else interval '0 month' end)::date
       and (l.end_date is null or v_period <= l.end_date)
       and not exists (select 1 from bills b
                        where b.lease_id = l.id
                          and b.bill_type = 'monthly'
                          and b.billing_period = v_period)
  loop
    v_bill := null;
    insert into bills (lease_id, bill_type, billing_period, due_date, created_by)
    values (r.lease_id, 'monthly', v_period, v_period + (r.due_day - 1), r.owner_id)
    on conflict (lease_id, billing_period, bill_type) do nothing
    returning id into v_bill;

    if v_bill is null then continue; end if;   -- someone else just made it

    insert into bill_items (bill_id, description, category, amount, sort_order)
    values (v_bill, 'Monthly rent', 'rent', r.monthly_rent, 1);

    -- Fixed charges come straight from the lease (they cannot be changed here)
    insert into bill_items (bill_id, description, category, amount, sort_order)
    select v_bill, c2.name, c2.category, c2.fixed_amount,
           (1 + row_number() over (order by c2.name))::smallint
      from lease_charges c2
     where c2.lease_id = r.lease_id and c2.active and c2.mode = 'fixed';

    -- Variable charges: only the amounts the landlord entered for this lease
    e := null;
    select elem.value into e
      from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as elem(value)
     where elem.value->>'lease_id' = r.lease_id::text
     limit 1;

    if e is not null then
      v_sort := 50;
      for v in select vv.value
                 from jsonb_array_elements(coalesce(e->'variables', '[]'::jsonb)) as vv(value)
      loop
        v_amount := round(coalesce(nullif(v->>'amount', '')::numeric, 0), 2);
        continue when v_amount <= 0;

        select lc.name, lc.category into c
          from lease_charges lc
         where lc.id = (v->>'charge_id')::uuid
           and lc.lease_id = r.lease_id
           and lc.active and lc.mode = 'variable';

        if found then
          insert into bill_items (bill_id, description, category, amount, sort_order)
          values (v_bill, c.name, c.category, v_amount, v_sort);
          v_sort := v_sort + 1;
        end if;
      end loop;
    end if;

    insert into notifications (recipient_id, type, title, body, bill_id, unit_id, property_id)
    values (r.tenant_id, 'bill_issued', 'New bill',
            'Your bill for ' || to_char(v_period, 'FMMonth YYYY') || ' is ready.',
            v_bill, r.unit_id, r.property_id);

    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

grant execute on function landlord_bill_preview(uuid, date)        to authenticated;
grant execute on function create_monthly_bills(uuid, date, jsonb)  to authenticated;


-- =====================================================================
-- 026_edit_lease.sql
-- Powers the "Edit lease" overlay in Units and invites.
--
--   landlord_lease_details(lease)   loads a lease for the form
--   update_lease(lease, changes)    saves it
--
-- What can change, and how:
--   * Monthly rent and due day: for an ACTIVE lease this adds a new set of terms that applies
--     from the month you pick (this month or later). Bills that already exist keep their old
--     amounts, and earlier months are never rewritten. Any change that was scheduled for a
--     LATER month is replaced by the new one. For a lease still waiting for its tenant,
--     the first terms are edited directly.
--   * Charges (water, dues, ...): added, edited or removed. Only bills created from now on use
--     them. A removed charge is switched off, not deleted.
--   * End date: optional. No bills are created after it.
--   * Start date, security deposit and advance rent: only while the tenant has not joined yet
--     (after that they have already been billed).
-- Safe to run more than once.
--
-- Changes from the first version of this file:
--   * Start date and end date are saved in ONE statement, so moving the start past the old end
--     date while setting a new end date no longer fails the date check.
--   * Renaming a charge to the name of a removed charge no longer fails; the removed one is
--     renamed out of the way. Charges taken out of the form are switched off first, so a new
--     charge can reuse their name.
--   * A rent change scheduled for a later month is now returned as 'scheduled_changes' and is
--     replaced when you save a new change.
--   * leases.updated_at is refreshed on every save.
-- =====================================================================

create or replace function landlord_lease_details(p_lease uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_l     leases;
  v_prop  uuid;
  v_terms lease_terms;
begin
  select * into v_l from leases where id = p_lease;
  if not found then raise exception 'not_found'; end if;
  select property_id into v_prop from units where id = v_l.unit_id;
  if not owns_property(v_prop) then raise exception 'not_allowed'; end if;

  -- The terms in force today (a lease that has not started yet uses its first terms)
  select * into v_terms
    from lease_terms
   where lease_id = p_lease and (v_l.status = 'pending' or effective_from <= ph_today())
   order by effective_from desc limit 1;
  if not found then
    select * into v_terms from lease_terms where lease_id = p_lease order by effective_from limit 1;
  end if;

  return jsonb_build_object(
    'lease_id',         v_l.id,
    'status',           v_l.status,
    'unit_label',       (select label from units where id = v_l.unit_id),
    'tenant_name',      (select first_name || ' ' || last_name from profiles where id = v_l.tenant_id),
    'start_date',       v_l.start_date,
    'end_date',         v_l.end_date,
    'security_deposit', v_l.security_deposit,
    'advance_rent',     v_l.advance_rent,
    'monthly_rent',     v_terms.monthly_rent,
    'due_day',          v_terms.due_day,
    'has_current_bill', exists (select 1 from bills b
                                 where b.lease_id = p_lease and b.bill_type = 'monthly'
                                   and b.billing_period = date_trunc('month', ph_today())::date),
    -- Changes already scheduled for a later month (active leases only)
    'scheduled_changes', case when v_l.status = 'active' then coalesce((
        select jsonb_agg(jsonb_build_object(
                 'effective_from', t.effective_from, 'monthly_rent', t.monthly_rent,
                 'due_day', t.due_day, 'change_reason', t.change_reason)
               order by t.effective_from)
          from lease_terms t
         where t.lease_id = p_lease and t.effective_from > ph_today()), '[]'::jsonb)
      else '[]'::jsonb end,
    'charges', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'name', c.name, 'category', c.category,
                 'mode', c.mode, 'fixed_amount', c.fixed_amount) order by c.name)
          from lease_charges c where c.lease_id = p_lease and c.active), '[]'::jsonb)
  );
end $$;

-- p_changes (every key is optional):
--   monthly_rent, due_day, effective_from ('YYYY-MM-01'), change_reason,
--   end_date (null clears it), start_date, security_deposit, advance_rent (pending leases only),
--   charges: [ { id?, name, category: utility|fee|other, mode: fixed|variable, fixed_amount } ]
--            Every charge you want to keep must be in the list; active charges left out are switched off.
create or replace function update_lease(p_lease uuid, p_changes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_l         leases;
  v_prop      uuid;
  v_uid       uuid := auth.uid();
  v_today     date := ph_today();
  v_rent      numeric;
  v_due       int;
  v_from      date;
  v_cur_rent  numeric;
  v_cur_due   int;
  v_first     uuid;
  v_new_start date;
  v_new_end   date;
  v_keep      uuid[] := '{}';
  v_id        uuid;
  ch          jsonb;
  v_name      text;
  v_mode      charge_mode;
  v_cat       charge_category;
  v_amt       numeric;
begin
  select * into v_l from leases where id = p_lease;
  if not found then raise exception 'not_found'; end if;
  select property_id into v_prop from units where id = v_l.unit_id;
  if not owns_property(v_prop) then raise exception 'not_allowed'; end if;
  if v_l.status not in ('pending', 'active') then raise exception 'lease_closed'; end if;

  -- ---- start date and end date, saved together so the date check sees both new values
  v_new_start := v_l.start_date;
  v_new_end   := v_l.end_date;

  if v_l.status = 'pending' and p_changes->'start_date' is not null then
    v_new_start := nullif(p_changes->>'start_date', '')::date;
    if v_new_start is null then raise exception 'invalid_start_date'; end if;
  end if;

  if p_changes->'end_date' is not null then
    v_new_end := nullif(p_changes->>'end_date', '')::date;   -- null clears it
  end if;

  if v_new_end is not null and v_new_end < v_new_start then raise exception 'invalid_end_date'; end if;

  if v_new_start is distinct from v_l.start_date or v_new_end is distinct from v_l.end_date then
    update leases set start_date = v_new_start, end_date = v_new_end where id = p_lease;
  end if;

  -- ---- deposit, advance and first terms: only before the tenant has joined
  if v_l.status = 'pending' then
    if v_new_start is distinct from v_l.start_date then
      -- the first terms begin in the same month as the lease
      update lease_terms set effective_from = date_trunc('month', v_new_start)::date
       where id = (select id from lease_terms where lease_id = p_lease order by effective_from limit 1);
    end if;
    if p_changes->'security_deposit' is not null then
      update leases set security_deposit = greatest(coalesce((p_changes->>'security_deposit')::numeric, 0), 0)
       where id = p_lease;
    end if;
    if p_changes->'advance_rent' is not null then
      update leases set advance_rent = greatest(coalesce((p_changes->>'advance_rent')::numeric, 0), 0)
       where id = p_lease;
    end if;
  end if;

  -- ---- monthly rent and due day
  v_rent := nullif(p_changes->>'monthly_rent', '')::numeric;
  v_due  := nullif(p_changes->>'due_day', '')::int;
  if v_rent is not null and v_rent < 0 then raise exception 'invalid_rent'; end if;
  if v_due is not null and v_due not between 1 and 28 then raise exception 'invalid_due_day'; end if;

  if v_rent is not null or v_due is not null then
    if v_l.status = 'pending' then
      select id into v_first from lease_terms where lease_id = p_lease order by effective_from limit 1;
      update lease_terms
         set monthly_rent = coalesce(v_rent, monthly_rent),
             due_day      = coalesce(v_due, due_day)::smallint
       where id = v_first;
    else
      v_from := date_trunc('month', coalesce(nullif(p_changes->>'effective_from', '')::date, v_today))::date;
      if v_from < date_trunc('month', v_today)::date then raise exception 'invalid_effective_from'; end if;

      select monthly_rent, due_day into v_cur_rent, v_cur_due
        from lease_terms
       where lease_id = p_lease and effective_from <= v_from
       order by effective_from desc limit 1;
      if not found then
        select monthly_rent, due_day into v_cur_rent, v_cur_due
          from lease_terms where lease_id = p_lease order by effective_from limit 1;
      end if;

      if v_cur_rent is distinct from coalesce(v_rent, v_cur_rent)
         or v_cur_due is distinct from coalesce(v_due, v_cur_due) then
        -- A change scheduled for a later month is replaced by this one
        delete from lease_terms where lease_id = p_lease and effective_from > v_from;

        insert into lease_terms (lease_id, effective_from, monthly_rent, due_day, change_reason, created_by)
        values (p_lease, v_from, coalesce(v_rent, v_cur_rent), coalesce(v_due, v_cur_due),
                nullif(trim(coalesce(p_changes->>'change_reason', '')), ''), v_uid)
        on conflict (lease_id, effective_from) do update
          set monthly_rent  = excluded.monthly_rent,
              due_day       = excluded.due_day,
              change_reason = excluded.change_reason,
              created_by    = excluded.created_by;
      end if;
    end if;
  end if;

  -- ---- charges
  if p_changes->'charges' is not null then
    -- 1. Switch off every active charge that is not in the list, first, so that a new or renamed
    --    charge can reuse its name. They are kept for history.
    select coalesce(array_agg((cc.value->>'id')::uuid), '{}') into v_keep
      from jsonb_array_elements(p_changes->'charges') as cc(value)
     where nullif(cc.value->>'id', '') is not null;

    update lease_charges set active = false
     where lease_id = p_lease and active and not (id = any(v_keep));

    -- 2. Add, edit or switch back on the charges in the list
    for ch in select cc.value from jsonb_array_elements(p_changes->'charges') as cc(value) loop
      v_name := trim(coalesce(ch->>'name', ''));
      if v_name = '' then raise exception 'invalid_charge'; end if;
      v_mode := (ch->>'mode')::charge_mode;
      v_cat  := (ch->>'category')::charge_category;
      v_amt  := case when v_mode = 'fixed' then nullif(ch->>'fixed_amount', '')::numeric else null end;
      if v_mode = 'fixed' and (v_amt is null or v_amt < 0) then raise exception 'invalid_charge'; end if;

      if nullif(ch->>'id', '') is not null then
        v_id := (ch->>'id')::uuid;

        -- A removed charge that already has this name is renamed out of the way
        update lease_charges
           set name = name || ' (removed ' || left(id::text, 8) || ')'
         where lease_id = p_lease and not active and name = v_name and id <> v_id;

        update lease_charges
           set name = v_name, category = v_cat, mode = v_mode, fixed_amount = v_amt, active = true
         where id = v_id and lease_id = p_lease;
        if not found then raise exception 'invalid_charge'; end if;
      else
        -- A charge removed earlier with the same name is switched back on
        insert into lease_charges (lease_id, name, category, mode, fixed_amount, active)
        values (p_lease, v_name, v_cat, v_mode, v_amt, true)
        on conflict (lease_id, name) do update
          set category = excluded.category, mode = excluded.mode,
              fixed_amount = excluded.fixed_amount, active = true;
      end if;
    end loop;
  end if;

  update leases set updated_at = now() where id = p_lease;
end $$;

grant execute on function landlord_lease_details(uuid)  to authenticated;
grant execute on function update_lease(uuid, jsonb)     to authenticated;


-- =====================================================================
-- 027_remove_auto_bill_generation.sql
-- Bills are now created only from the "Create bills" screen (025), where the landlord types
-- the variable charges (water, electricity, ...). Any automatic or one-click generator would
-- create bills without those amounts, so they are removed:
--
--   generate_monthly_bills(property, month)   the old "Generate bills" button
--   generate_all_monthly_bills()              the optional daily schedule
--   _generate_bills_for_period(period, prop)  the worker both of them used
--
-- It also removes the 'aptify-monthly-bills' schedule if it was ever created. Other scheduled
-- jobs (for example purge-unverified-signups) are not touched.
-- Safe to run more than once.
-- =====================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
       from cron.job
      where jobname = 'aptify-monthly-bills';
  end if;
end $$;

drop function if exists generate_monthly_bills(uuid, date);
drop function if exists generate_all_monthly_bills();
drop function if exists _generate_bills_for_period(date, uuid);


-- =====================================================================
-- 028_tenant_home_current_bill.sql
-- Tenant "My Home" screen.
--
--   * current_bill is now THIS MONTH's bill (or a later one), the same rule the Payments page
--     uses. Before, it was the bill with the earliest due date, so a tenant with an old unpaid
--     bill saw that one instead of the current one.
--   * Bills from months that have already ended and still have a balance are not hidden:
--     unpaid_count and unpaid_total tell the screen how many there are and how much is owed,
--     so it can link to the Payments page.
--   * history, requests and announcements return more rows (24 / 30 / 30) because the
--     cards now scroll instead of cutting the list short.
-- Safe to run more than once.
-- =====================================================================

create or replace function tenant_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_lease leases;
  v_prop  uuid;
  v_open  jsonb;
  v_month date := date_trunc('month', now() at time zone 'Asia/Manila')::date;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select l.* into v_lease
    from leases l
   where l.tenant_id = auth.uid() and l.status = 'active'
   order by l.created_at desc limit 1;

  if not found then return jsonb_build_object('has_lease', false); end if;

  select u.property_id into v_prop from units u where u.id = v_lease.unit_id;

  -- Every bill that still has a balance, oldest month first. is_past = its month has ended.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.billing_period, x.due_date), '[]'::jsonb)
    into v_open
    from (
      select b.id as bill_id, b.bill_type, b.billing_period, b.due_date,
             (it.total - b.discount)           as total_due,
             py.paid,
             (it.total - b.discount - py.paid) as balance,
             case when pend.id is not null then jsonb_build_object(
                    'payment_id', pend.id, 'amount', pend.amount,
                    'method', pend.method, 'created_at', pend.created_at) end as pending,
             case when pend.id is null then (
                    select jsonb_build_object(
                             'reason', rj.rejection_reason, 'message', rj.rejection_message,
                             'amount', rj.amount, 'method', rj.method)
                      from payments rj
                     where rj.bill_id = b.id and rj.status = 'rejected'
                     order by rj.updated_at desc limit 1) end as rejected,
             (b.billing_period < v_month) as is_past
        from bills b
        cross join lateral (select coalesce(sum(amount), 0) as total
                              from bill_items where bill_id = b.id) it
        cross join lateral (select coalesce(sum(amount), 0) as paid
                              from payments where bill_id = b.id and status = 'confirmed') py
        left join lateral (select * from payments
                            where bill_id = b.id and status = 'pending'
                            order by created_at desc limit 1) pend on true
       where b.lease_id = v_lease.id and (it.total - b.discount - py.paid) > 0
    ) x;

  return jsonb_build_object(
    'has_lease', true,
    'unit_label', (select label from units where id = v_lease.unit_id),
    'property_name', (select name from properties where id = v_prop),

    -- This month's bill (or a later one) that still has a balance
    'current_bill', (
      select e from jsonb_array_elements(v_open) with ordinality t(e, n)
       where not (e->>'is_past')::boolean
       order by n limit 1),

    -- Bills from months that have already ended and are still not fully paid
    'unpaid_count', (select count(*) from jsonb_array_elements(v_open) e
                      where (e->>'is_past')::boolean),
    'unpaid_total', (select coalesce(sum((e->>'balance')::numeric), 0)
                       from jsonb_array_elements(v_open) e
                      where (e->>'is_past')::boolean),

    'history', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.created_at desc)
        from (select pay.id, b.billing_period, b.bill_type, pay.amount, pay.method,
                     pay.status, pay.created_at
                from payments pay
                join bills b on b.id = pay.bill_id
               where b.lease_id = v_lease.id
               order by pay.created_at desc
               limit 24) h), '[]'::jsonb),

    'requests', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.created_at desc)
        from (select mr.id, mr.title, mr.category, mr.urgency, mr.status, mr.created_at
                from maintenance_requests mr
               where mr.unit_id = v_lease.unit_id and mr.requested_by = auth.uid()
               order by mr.created_at desc
               limit 30) q), '[]'::jsonb),

    'announcements', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.published_at desc)
        from (select an.id, an.title, an.published_at
                from announcements an
               where an.property_id = v_prop
                 and an.status = 'published'
                 and (an.audience = 'property'
                      or exists (select 1 from announcement_units au
                                  where au.announcement_id = an.id
                                    and au.unit_id = v_lease.unit_id))
               order by an.published_at desc
               limit 30) a), '[]'::jsonb)
  );
end $$;


-- =====================================================================
-- 029_rent_reminder_rules.sql
-- The landlord's "Send reminder" button (Rent ledger, Overview).
--
-- send_rent_reminder(bill) now:
--   * refuses a bill that has nothing left to pay                -> 'nothing_due'
--   * respects the tenant's "rent reminders" setting             -> 'reminders_off'
--   * allows ONE reminder per bill every 24 hours                -> 'recently_reminded'
--   * writes a message with the amount and due date, not a generic line
-- The tenant sees the reminder in the new Notifications page (bell in the sidebar).
-- Safe to run more than once.
-- =====================================================================

create index if not exists notifications_bill_type_created_idx
  on notifications (bill_id, type, created_at desc);

create or replace function send_rent_reminder(p_bill uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant  uuid;
  v_unit    uuid;
  v_prop    uuid;
  v_due     date;
  v_period  date;
  v_balance numeric;
  v_today   date := (now() at time zone 'Asia/Manila')::date;
  v_body    text;
begin
  if not manages_bill(p_bill) then raise exception 'not_allowed'; end if;

  select l.tenant_id, u.id, u.property_id, b.due_date, b.billing_period,
         (coalesce((select sum(amount) from bill_items   where bill_id = b.id), 0)
          - b.discount
          - coalesce((select sum(amount) from payments where bill_id = b.id and status = 'confirmed'), 0))
    into v_tenant, v_unit, v_prop, v_due, v_period, v_balance
    from bills b
    join leases l on l.id = b.lease_id
    join units  u on u.id = l.unit_id
   where b.id = p_bill;

  if v_tenant is null then raise exception 'no_tenant'; end if;
  if coalesce(v_balance, 0) <= 0 then raise exception 'nothing_due'; end if;

  if exists (select 1 from notification_preferences
              where user_id = v_tenant and not rent_reminders) then
    raise exception 'reminders_off';
  end if;

  if exists (select 1 from notifications
              where bill_id = p_bill and type = 'rent_reminder'
                and created_at > now() - interval '24 hours') then
    raise exception 'recently_reminded';
  end if;

  v_body := 'Your landlord sent a reminder: PHP ' || to_char(v_balance, 'FM999,999,990.00')
         || ' for ' || to_char(v_period, 'FMMonth YYYY')
         || case when v_due < v_today
                 then ' was due on ' || to_char(v_due, 'FMMonth FMDD, YYYY') || '.'
                 else ' is due on '  || to_char(v_due, 'FMMonth FMDD, YYYY') || '.' end;

  insert into notifications (recipient_id, type, title, body, bill_id, unit_id, property_id)
  values (v_tenant, 'rent_reminder', 'Rent reminder', v_body, p_bill, v_unit, v_prop);
end $$;

grant execute on function send_rent_reminder(uuid) to authenticated;