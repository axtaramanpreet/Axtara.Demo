-- ---------------------------------------------------------------------------
-- Local development seed
-- ---------------------------------------------------------------------------
-- Applied by `supabase db reset`. Local only — it creates a user with a known
-- password and must never be run against a hosted project.
--
-- Sets up the illustrative fund from the handoff so the app has something real
-- to render: one fund mid-call and one with no calls at all, which is the empty
-- state the Home screen has to handle.
--
-- Call inputs go in through save_call_inputs rather than direct inserts, so the
-- seed exercises the same path the application uses.
-- ---------------------------------------------------------------------------

-- Sign in with dev@axtara.local / password
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  -- GoTrue reads these into non-nullable strings, so NULL makes every sign-in
  -- fail with "Database error querying schema". They must be empty, not unset.
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, reauthentication_token
)
values (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'dev@axtara.local',
  crypt('password', gen_salt('bf')),
  now(), now(), now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"name": "Dev User"}'::jsonb,
  '', '', '', '', '', ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at
)
values (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'email',
  '{"sub": "00000000-0000-4000-8000-000000000001", "email": "dev@axtara.local", "email_verified": true}'::jsonb,
  now(), now(), now()
)
on conflict (provider_id, provider) do nothing;


insert into firms (id, name)
values ('00000000-0000-4000-8000-0000000000f1', 'Axtara Fund Services')
on conflict (id) do nothing;

insert into firm_members (firm_id, user_id, role)
values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

insert into clients (id, firm_id, name)
values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000f1', 'Illustrative Fund II, L.P.'),
  -- No calls: the Home screen's empty state.
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000f1', 'Illustrative Fund III, L.P.')
on conflict (id) do nothing;


-- Call No. 2 — the workbook's own example, which ties to Expected_Output.
insert into calls (id, client_id, call_no, fund_name, reporting_currency)
values ('00000000-0000-4000-8000-0000000000a2',
        '00000000-0000-4000-8000-0000000000c1',
        2, 'Illustrative Fund II, L.P.', 'USD')
on conflict (id) do nothing;

select save_call_inputs(
  '00000000-0000-4000-8000-0000000000a2',
  '{"call_date": "2026-09-30", "payment_due_date": "2026-10-14",
    "default_mgmt_fee_rate_annual": 0.02, "default_mgmt_fee_basis": "Commitment",
    "mgmt_fee_period_fraction": 0.25, "org_expense_cap": 1500000,
    "rounding_decimals": 2, "rounding_plug_lp_id": "LP04",
    "fee_basis": "Commitment", "fee_default_rate_annual": 0.02,
    "fee_period_fraction": 0.25, "fee_reduces_unfunded": true,
    "fee_exempt_lp_ids": ["GP01"]}'::jsonb,
  '{"setup": "template", "lps": "template", "components": "template",
    "fee": "template", "transfers": "template"}'::jsonb,
  '[{"lp_id": "LP01", "lp_name": "Alpha Pension Trust", "lp_type": "LP",
     "contact_email": "treasury@alphapension.example",
     "commitment": 10000000, "opening_paid_in": 2000000, "opening_ucc": 8000000,
     "opening_invested_capital": 1800000, "status": "Active", "position": 0},
    {"lp_id": "LP02", "lp_name": "Beta University Endowment", "lp_type": "LP",
     "contact_email": "investments@betaendowment.example",
     "commitment": 7500000, "opening_paid_in": 750000, "opening_ucc": 6750000,
     "opening_invested_capital": 675000, "status": "Active", "position": 1},
    {"lp_id": "LP03", "lp_name": "Gamma Family Office", "lp_type": "LP",
     "contact_email": "ops@gammafo.example", "side_letter_ref": "SL-2024-03",
     "notes": "Mgmt fee reduced to 1% per side letter",
     "commitment": 5000000, "opening_paid_in": 2000000, "opening_ucc": 3000000,
     "opening_invested_capital": 1800000, "mgmt_fee_rate_override": 0.01,
     "status": "Active", "position": 2},
    {"lp_id": "LP04", "lp_name": "Delta Insurance Co", "lp_type": "LP",
     "contact_email": "altinvest@deltainsurance.example",
     "notes": "Largest commitment; rounding plug",
     "commitment": 15000000, "opening_paid_in": 1500000, "opening_ucc": 13500000,
     "opening_invested_capital": 1350000, "status": "Active", "position": 3},
    {"lp_id": "LP05", "lp_name": "Epsilon Sovereign Fund", "lp_type": "LP",
     "contact_email": "pe@epsilonswf.example",
     "commitment": 12500000, "opening_paid_in": 3500000, "opening_ucc": 9000000,
     "opening_invested_capital": 3150000, "status": "Active", "position": 4},
    {"lp_id": "GP01", "lp_name": "Fund GP LLC", "lp_type": "GP",
     "contact_email": "finance@fundgp.example",
     "notes": "GP commitment; exempt from mgmt fee",
     "commitment": 500000, "opening_paid_in": 50000, "opening_ucc": 450000,
     "opening_invested_capital": 45000, "fee_exempt": true,
     "status": "Active", "position": 5}]'::jsonb,
  '[{"component_id": "C1", "component_name": "Deal X", "category": "Deal",
     "total_amount": 3000000, "allocation_basis": "Commitment",
     "reduces_unfunded": true, "notes": "Allocated on committed capital.", "position": 0},
    {"component_id": "C2", "component_name": "Deal Y", "category": "Deal",
     "total_amount": 2000000, "allocation_basis": "Commitment",
     "reduces_unfunded": true, "notes": "Allocated on committed capital.", "position": 1},
    {"component_id": "C3", "component_name": "Deal Z", "category": "Deal",
     "total_amount": 1500000, "allocation_basis": "UCC",
     "reduces_unfunded": true, "notes": "Allocated on UNFUNDED commitment.", "position": 2},
    {"component_id": "C4", "component_name": "Partnership Expense",
     "category": "Partnership Expense", "total_amount": 200000,
     "allocation_basis": "Commitment", "reduces_unfunded": true, "position": 3},
    {"component_id": "C5", "component_name": "Organizational Expense",
     "category": "Organizational Expense", "total_amount": 150000,
     "allocation_basis": "Commitment", "reduces_unfunded": false,
     "notes": "OUTSIDE commitment: does NOT reduce unfunded.", "position": 4}]'::jsonb,
  '[{"offset_id": "O1", "description": "GP transaction fee offset (100% sharing)",
     "amount": 50000, "allocation_method": "Pro-rata to gross fee", "position": 0}]'::jsonb,
  '[{"transfer_id": "T1", "effective_date": "2026-12-31",
     "from_lp_id": "LP05", "to_lp_id": "LP06",
     "to_lp_name_if_new": "Zeta Capital Partners", "transfer_type": "Partial",
     "transfer_pct": 0.4, "transfers_commitment": true, "transfers_paid_in": true,
     "transfers_ucc": true,
     "notes": "ILLUSTRATIVE: 40% of LP05 to new LP06, effective next call.", "position": 0}]'::jsonb,
  '[{"lp_id": "LP01", "figures": {"Deal_X": 594059.41, "Deal_Y": 396039.60, "Deal_Z": 294840.29, "Partnership_Exp": 39603.96, "Org_Exp": 29702.97, "Fee_Gross": 50000, "Fee_Offset": 10526.32, "Fee_Net": 39473.68, "Total_Call": 1393719.91, "Reduces_Unfunded_Amt": 1364016.94, "Closing_UCC": 6635983.06, "Closing_Paid_In": 3393719.91}, "position": 0},
    {"lp_id": "LP02", "figures": {"Deal_X": 445544.55, "Deal_Y": 297029.70, "Deal_Z": 248771.50, "Partnership_Exp": 29702.97, "Org_Exp": 22277.23, "Fee_Gross": 37500, "Fee_Offset": 7894.74, "Fee_Net": 29605.26, "Total_Call": 1072931.21, "Reduces_Unfunded_Amt": 1050653.98, "Closing_UCC": 5699346.02, "Closing_Paid_In": 1822931.21}, "position": 1},
    {"lp_id": "LP03", "figures": {"Deal_X": 297029.70, "Deal_Y": 198019.80, "Deal_Z": 110565.11, "Partnership_Exp": 19801.98, "Org_Exp": 14851.49, "Fee_Gross": 12500, "Fee_Offset": 2631.58, "Fee_Net": 9868.42, "Total_Call": 650136.50, "Reduces_Unfunded_Amt": 635285.01, "Closing_UCC": 2364714.99, "Closing_Paid_In": 2650136.50}, "position": 2},
    {"lp_id": "LP04", "figures": {"Deal_X": 891089.11, "Deal_Y": 594059.42, "Deal_Z": 497543.00, "Partnership_Exp": 59405.94, "Org_Exp": 44554.45, "Fee_Gross": 75000, "Fee_Offset": 15789.47, "Fee_Net": 59210.53, "Total_Call": 2145862.45, "Reduces_Unfunded_Amt": 2101308.00, "Closing_UCC": 11398692.00, "Closing_Paid_In": 3645862.45}, "position": 3},
    {"lp_id": "LP05", "figures": {"Deal_X": 742574.26, "Deal_Y": 495049.50, "Deal_Z": 331695.33, "Partnership_Exp": 49504.95, "Org_Exp": 37128.71, "Fee_Gross": 62500, "Fee_Offset": 13157.89, "Fee_Net": 49342.11, "Total_Call": 1705294.86, "Reduces_Unfunded_Amt": 1668166.15, "Closing_UCC": 7331833.85, "Closing_Paid_In": 5205294.86}, "position": 4},
    {"lp_id": "GP01", "figures": {"Deal_X": 29702.97, "Deal_Y": 19801.98, "Deal_Z": 16584.77, "Partnership_Exp": 1980.20, "Org_Exp": 1485.15, "Fee_Gross": 0, "Fee_Offset": 0, "Fee_Net": 0, "Total_Call": 69555.07, "Reduces_Unfunded_Amt": 68069.92, "Closing_UCC": 381930.08, "Closing_Paid_In": 119555.07}, "position": 5}]'::jsonb
);
