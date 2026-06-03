import { http, HttpResponse } from "msw";

// jsdom resolves relative URLs to http://localhost (port 80, not 3000)
const API = "http://localhost/api/v1";

// ── Auth ──────────────────────────────────────────────────────────────────────

export const handlers = [
  // Refresh — return a mock access token
  http.post(`${API}/auth/refresh/`, () =>
    HttpResponse.json({ success: true, data: { access: "mock-access-token" } })
  ),

  // Me
  http.get(`${API}/auth/me/`, () =>
    HttpResponse.json({
      success: true,
      data: {
        id: "user-1",
        name: "Test Admin",
        phone: "+919876543210",
        email: "admin@test.com",
        tenant_slug: "demo",
        shop_ids: ["shop-1"],
        role_ids: ["role-1"],
        permissions: [
          "crm.customers.view", "crm.customers.create",
          "repair.jobs.view", "repair.jobs.create",
          "pos.counter_sale.create",
          "erp.inventory.view", "erp.inventory.adjust",
          "erp.procurement.view",
          "billing.repair_invoices.view", "billing.repair_invoices.create", "billing.payments.record",
          "hr.employees.view", "hr.employees.manage",
          "hr.attendance.view", "hr.attendance.mark",
          "hr.leaves.manage", "hr.salary.view", "hr.salary.generate",
          "reports.billing.view", "reports.repair.view", "reports.erp.view",
          "reports.hr.view", "reports.crm.view", "reports.amc.view",
          "amc.contracts.view", "amc.contracts.create", "amc.contracts.edit",
          "amc.visits.schedule", "amc.visits.complete", "amc.renewals.manage",
          "hr.petty_cash.manage",
          "erp.expenses.manage", "erp.assets.manage", "erp.budgets.manage",
          "settings.commission_rules.manage",
        ],
        is_platform_admin: false,
      },
    })
  ),

  // ── CRM ────────────────────────────────────────────────────────────────────

  http.get(`${API}/crm/customers/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          id: "cust-1", name: "Ravi Kumar", phone: "+919876543210",
          alternate_phone: null, email: "ravi@test.com", address: "123 MG Road",
          city: "Bangalore", gstin: null, customer_type: "individual",
          credit_limit: "5000.00", tags: ["vip"], total_jobs: 3,
          total_billed: "15000.00", total_outstanding: "2000.00",
          whatsapp_optout: false, source_lead: null,
          created_at: "2025-01-15T10:00:00Z", updated_at: "2025-01-15T10:00:00Z",
        },
      ],
      meta: { next_cursor: null, prev_cursor: null },
    })
  ),

  http.get(`${API}/crm/customers/:id/`, ({ params }) =>
    HttpResponse.json({
      success: true,
      data: {
        id: params.id, name: "Ravi Kumar", phone: "+919876543210",
        alternate_phone: null, email: "ravi@test.com", address: "123 MG Road",
        city: "Bangalore", gstin: null, customer_type: "individual",
        credit_limit: "5000.00", tags: ["vip"], total_jobs: 3,
        total_billed: "15000.00", total_outstanding: "2000.00",
        whatsapp_optout: false, source_lead: null,
        created_at: "2025-01-15T10:00:00Z", updated_at: "2025-01-15T10:00:00Z",
      },
    })
  ),

  http.post(`${API}/crm/customers/`, () =>
    HttpResponse.json(
      { success: true, data: { id: "cust-new", name: "New Customer", phone: "+919999999999" } },
      { status: 201 }
    )
  ),

  // ── Repair ─────────────────────────────────────────────────────────────────

  http.get(`${API}/repair/jobs/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          id: "job-1", job_number: "JOB-001", customer_name: "Ravi Kumar",
          customer_phone: "+919876543210", device_type: "Smartphone",
          brand: "Apple", model: "iPhone 13", status: "repair",
          service_charge: "3500.00", created_at: "2025-01-20T10:00:00Z",
          technician_name: "Suresh",
        },
      ],
      meta: { next_cursor: null, prev_cursor: null },
    })
  ),

  // ── Inventory ──────────────────────────────────────────────────────────────

  http.get(`${API}/inventory/products/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          id: "prod-1", category: null, name: "iPhone Screen", sku: "SCRI13",
          brand: "Apple", description: null, hsn_code: "8517", default_tax_rate: "18.00",
          is_for_sale: true, is_for_repair_use: true, is_active: true,
          variants: [
            {
              id: "var-1", product: "prod-1", variant_name: "Original",
              sku: "SCRI13-OG", buying_price: "2500.00", selling_price: "4500.00",
              gst_rate: "18.00", hsn_code: "8517", reorder_level: 2,
              stock_qty: 5, created_at: "2025-01-01T00:00:00Z",
            },
          ],
          created_at: "2025-01-01T00:00:00Z",
        },
      ],
      meta: { next_cursor: null, prev_cursor: null },
    })
  ),

  http.get(`${API}/inventory/variants/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          id: "var-1", product_id: "prod-1", product_name: "iPhone Screen",
          variant_name: "Original", sku: "SCRI13-OG", selling_price: "4500.00",
          gst_rate: "18.00", hsn_code: "8517", stock_qty: 5,
        },
      ],
      meta: { next_cursor: null, prev_cursor: null },
    })
  ),

  // ── Procurement ────────────────────────────────────────────────────────────

  http.get(`${API}/procurement/purchase-orders/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          id: "po-1", po_number: "PO-2025-001", supplier_name: "Parts India",
          status: "sent", expected_delivery_date: "2025-02-01",
          notes: null, created_at: "2025-01-18T09:00:00Z",
        },
      ],
      meta: { next_cursor: null, prev_cursor: null },
    })
  ),

  http.get(`${API}/procurement/suppliers/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          id: "sup-1", name: "Parts India", phone: "+911234567890",
          email: "parts@india.com", gstin: null, city: "Mumbai",
          outstanding_balance: "12000.00", created_at: "2024-12-01T00:00:00Z",
        },
      ],
      meta: { next_cursor: null, prev_cursor: null },
    })
  ),

  // ── Billing ────────────────────────────────────────────────────────────────

  http.get(`${API}/billing/repair-invoices/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          id: "inv-1", invoice_number: "INV-2025-001", status: "partially_paid",
          customer_name: "Ravi Kumar", customer_phone: "+919876543210",
          job_number: "JOB-001", grand_total: "4130.00", amount_paid: "2000.00",
          amount_outstanding: "2130.00", due_date: null, pdf_url: "",
          created_at: "2025-01-20T10:00:00Z",
        },
      ],
      meta: { next_cursor: null, prev_cursor: null },
    })
  ),

  http.get(`${API}/billing/repair-invoices/:id/`, ({ params }) =>
    HttpResponse.json({
      success: true,
      data: {
        id: params.id, invoice_number: "INV-2025-001", status: "partially_paid",
        customer_name: "Ravi Kumar", customer_phone: "+919876543210",
        customer_gstin: null, job_number: "JOB-001", shop_name: "Demo Shop",
        subtotal: "3500.00", discount_amount: "0.00",
        cgst: "315.00", sgst: "315.00", igst: "0.00",
        grand_total: "4130.00", amount_paid: "2000.00", amount_outstanding: "2130.00",
        due_date: null, pdf_url: "", created_at: "2025-01-20T10:00:00Z",
        items: [
          {
            id: "item-1", item_type: "labor", description: "Screen Replacement",
            sac_code: "998714", hsn_code: "", quantity: "1.000",
            unit_price: "3500.00", tax_rate: "18.00", line_total: "4130.00",
          },
        ],
        payments: [
          {
            id: "pay-1", invoice: params.id, amount: "2000.00", method: "cash",
            reference_id: "", razorpay_payment_id: null, razorpay_order_id: null,
            paid_at: "2025-01-20T12:00:00Z", notes: "",
          },
        ],
      },
    })
  ),

  http.post(`${API}/billing/payments/`, () =>
    HttpResponse.json(
      {
        success: true,
        data: {
          id: "pay-2", invoice: "inv-1", amount: "2130.00", method: "upi",
          reference_id: "UTR123", paid_at: "2025-01-21T10:00:00Z", notes: "",
        },
      },
      { status: 201 }
    )
  ),

  http.get(`${API}/pos/sales/`, () =>
    HttpResponse.json({
      success: true,
      data: [],
      meta: { next_cursor: null, prev_cursor: null },
    })
  ),

  // ── HR ─────────────────────────────────────────────────────────────────────

  http.get(`${API}/hr/employees/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          id: "emp-1", shop: "shop-1", employee_code: "EMP001",
          full_name: "Suresh Kumar", designation: "Technician",
          department: "Service", date_of_joining: "2024-01-01",
          date_of_leaving: null, employment_type: "full_time",
          basic_salary: "20000.00", hra: "5000.00", other_allowances: "2000.00",
          gross_salary: "27000.00", pf_employee: "2400.00", pf_employer: "2400.00",
          esic_employee: "202.50", esic_employer: "675.00", bank_ifsc: "SBIN0001234",
          bank_account_number: "****", pan_number: "****", aadhar_number: "****",
        },
      ],
    })
  ),

  http.get(`${API}/hr/employees/:id/`, ({ params }) =>
    HttpResponse.json({
      success: true,
      data: {
        id: params.id, shop: "shop-1", employee_code: "EMP001",
        full_name: "Suresh Kumar", designation: "Technician",
        department: "Service", date_of_joining: "2024-01-01",
        date_of_leaving: null, employment_type: "full_time",
        basic_salary: "20000.00", hra: "5000.00", other_allowances: "2000.00",
        gross_salary: "27000.00", pf_employee: "2400.00", pf_employer: "2400.00",
        esic_employee: "202.50", esic_employer: "675.00", bank_ifsc: "SBIN0001234",
        bank_account_number: "****", pan_number: "****", aadhar_number: "****",
      },
    })
  ),

  http.post(`${API}/hr/employees/`, () =>
    HttpResponse.json(
      { success: true, data: { id: "emp-new", full_name: "New Employee" } },
      { status: 201 }
    )
  ),

  http.post(`${API}/hr/attendance/bulk/`, () =>
    HttpResponse.json({ success: true, data: { created: 1, total: 1 } }, { status: 201 })
  ),

  http.get(`${API}/hr/leave-requests/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          id: "leave-1", employee: "emp-1", employee_name: "Suresh Kumar",
          leave_type: "casual", from_date: "2025-01-25", to_date: "2025-01-25",
          days: "1.0", reason: "Personal work", status: "pending",
          approved_by: null, approved_at: null,
        },
      ],
    })
  ),

  http.patch(`${API}/hr/leave-requests/:id/`, () =>
    HttpResponse.json({
      success: true,
      data: { id: "leave-1", status: "approved" },
    })
  ),

  http.get(`${API}/hr/salary-slips/`, () =>
    HttpResponse.json({ success: true, data: [] })
  ),

  http.post(`${API}/hr/salary-slips/generate/`, () =>
    HttpResponse.json(
      { success: true, data: [{ id: "slip-1", employee: "emp-1", net_salary: "24397.50", status: "draft" }] },
      { status: 201 }
    )
  ),

  http.patch(`${API}/hr/salary-slips/:id/`, () =>
    HttpResponse.json({ success: true, data: { id: "slip-1", status: "approved" } })
  ),

  // ── AMC ────────────────────────────────────────────────────────────────────

  http.get(`${API}/amc/contracts/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          id: "amc-1", contract_number: "AMC-2025-001", title: "Annual AC Service",
          status: "active", customer_name: "Ravi Kumar",
          start_date: "2025-01-01", end_date: "2025-12-31",
          value: "12000.00", visits_per_year: 4,
        },
        {
          id: "amc-2", contract_number: "AMC-2025-002", title: "Quarterly Appliance Check",
          status: "pending_renewal", customer_name: "Priya Sharma",
          start_date: "2024-06-01", end_date: "2025-05-31",
          value: "8000.00", visits_per_year: 4,
        },
      ],
      meta: { next_cursor: null, prev_cursor: null },
    })
  ),

  http.get(`${API}/amc/contracts/:id/`, ({ params }) =>
    HttpResponse.json({
      success: true,
      data: {
        id: params.id, contract_number: "AMC-2025-001", title: "Annual AC Service",
        status: "active", customer_name: "Ravi Kumar", customer_id: "cust-1",
        shop_id: "shop-1", description: "Full maintenance of 3 AC units",
        start_date: "2025-01-01", end_date: "2025-12-31",
        value: "12000.00", payment_terms: "upfront",
        visits_per_year: 4, visit_interval_days: 91,
        auto_renew: true, renewal_reminder_days: 30,
        location_address: "123 MG Road, Bangalore",
        location_lat: null, location_lng: null,
        assigned_technician: null, notes: "",
        visits_count: 4, renewal_invoices: [],
        created_at: "2025-01-01T10:00:00Z", updated_at: "2025-01-01T10:00:00Z",
      },
    })
  ),

  http.get(`${API}/amc/contracts/:id/visits/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          id: "visit-1", visit_number: 1, scheduled_date: "2025-03-15",
          actual_date: "2025-03-15", status: "completed",
          technician: "emp-1", technician_name: "Suresh Kumar",
          work_done: "Full service and filter cleaning", issues_found: "",
          next_visit_date: "2025-06-15", customer_signature_url: "",
          photos: [], job_id: null, created_at: "2025-01-01T10:00:00Z",
        },
        {
          id: "visit-2", visit_number: 2, scheduled_date: "2025-06-15",
          actual_date: null, status: "scheduled",
          technician: null, technician_name: "",
          work_done: "", issues_found: "", next_visit_date: null,
          customer_signature_url: "", photos: [], job_id: null,
          created_at: "2025-01-01T10:00:00Z",
        },
      ],
      meta: { next_cursor: null, prev_cursor: null },
    })
  ),

  http.post(`${API}/amc/contracts/`, () =>
    HttpResponse.json(
      { success: true, data: { id: "amc-new", contract_number: "AMC-2025-003" } },
      { status: 201 }
    )
  ),

  http.post(`${API}/amc/contracts/:id/renew/`, ({ params }) =>
    HttpResponse.json({
      success: true,
      data: { id: params.id, status: "active", contract_number: "AMC-2025-001" },
    })
  ),

  http.post(`${API}/amc/visits/:id/complete/`, ({ params }) =>
    HttpResponse.json({
      success: true,
      data: {
        id: params.id, visit_number: 2, scheduled_date: "2025-06-15",
        actual_date: "2025-06-15", status: "completed",
        work_done: "Full service", issues_found: "",
      },
    })
  ),

  http.post(`${API}/amc/visits/:id/reschedule/`, ({ params }) =>
    HttpResponse.json({
      success: true,
      data: {
        id: params.id, visit_number: 2, scheduled_date: "2025-06-20",
        status: "rescheduled",
      },
    })
  ),

  // ── Commissions ────────────────────────────────────────────────────────────

  http.get(`${API}/commissions/rules/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        { id: "rule-1", name: "Standard Rate", rate: "10.00", lead_tech_share: "60.00",
          applies_to_job_type: null, effective_from: "2025-01-01", effective_to: null },
        { id: "rule-2", name: "Smartphone Rate", rate: "12.00", lead_tech_share: "70.00",
          applies_to_job_type: "Smartphone", effective_from: "2025-01-01", effective_to: "2025-12-31" },
      ],
    })
  ),

  http.post(`${API}/commissions/rules/`, () =>
    HttpResponse.json(
      { success: true, data: { id: "rule-new", name: "New Rule", rate: "8.00" } },
      { status: 201 }
    )
  ),

  http.get(`${API}/commissions/technician/:id/`, () =>
    HttpResponse.json({
      success: true,
      data: {
        technician_id: "emp-1",
        total_unpaid: "1500.00",
        commissions: [
          { id: "comm-1", job_number: "JOB-001", sc_amount: "3500.00", rate: "10.00",
            commission_amount: "350.00", is_lead: true, is_paid: false, payout_id: null },
          { id: "comm-2", job_number: "JOB-002", sc_amount: "5000.00", rate: "10.00",
            commission_amount: "500.00", is_lead: false, is_paid: true, payout_id: "pay-1" },
        ],
      },
    })
  ),

  http.get(`${API}/commissions/payouts/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        { id: "payout-1", technician: "emp-1", technician_name: "Suresh Kumar",
          period_start: "2025-01-01", period_end: "2025-01-31",
          total_commission: "1500.00", status: "draft", paid_at: null, pdf_url: "" },
      ],
    })
  ),

  http.post(`${API}/commissions/payouts/`, () =>
    HttpResponse.json(
      { success: true, data: { id: "payout-new", total_commission: "1500.00", status: "draft" } },
      { status: 201 }
    )
  ),

  http.patch(`${API}/commissions/payouts/:id/`, () =>
    HttpResponse.json({ success: true, data: { id: "payout-1", status: "approved" } })
  ),

  // ── Finance ────────────────────────────────────────────────────────────────

  // NOTE: literal path must come BEFORE the parametric :shopId handler
  http.get(`${API}/finance/petty-cash/transactions/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        { id: "txn-1", account: "acc-1", txn_type: "debit", amount: "200.00",
          category: "Stationery", description: "Pens and paper", date: "2025-01-15", balance_after: "4800.00" },
        { id: "txn-2", account: "acc-1", txn_type: "credit", amount: "2000.00",
          category: "", description: "Cash top-up", date: "2025-01-10", balance_after: "5000.00" },
      ],
    })
  ),

  http.post(`${API}/finance/petty-cash/transactions/`, () =>
    HttpResponse.json({ success: true, data: { id: "txn-new", balance_after: "4500.00" } }, { status: 201 })
  ),

  http.get(`${API}/finance/petty-cash/:shopId/`, () =>
    HttpResponse.json({
      success: true,
      data: { id: "acc-1", shop: "shop-1", name: "Main Cash", current_balance: "5000.00", low_balance_threshold: "1000.00" },
    })
  ),

  http.get(`${API}/finance/expenses/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        { id: "exp-1", shop: "shop-1", budget_head: null, category: "Travel",
          amount: "500.00", description: "Cab fare", date: "2025-01-20" },
      ],
    })
  ),

  http.post(`${API}/finance/expenses/`, () =>
    HttpResponse.json({ success: true, data: { id: "exp-new", amount: "300.00" } }, { status: 201 })
  ),

  http.get(`${API}/finance/budget/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        { id: "head-1", shop: "shop-1", name: "Operations", category: "fixed" },
        { id: "head-2", shop: "shop-1", name: "Marketing", category: "variable" },
      ],
    })
  ),

  http.get(`${API}/finance/budget/allocations/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        { id: "alloc-1", head: "head-1", month: 1, year: 2025,
          budgeted_amount: "10000.00", actual_amount: "7500.00", variance: "2500.00" },
      ],
    })
  ),

  http.post(`${API}/finance/budget/allocations/`, () =>
    HttpResponse.json({ success: true, data: { id: "alloc-new" } }, { status: 201 })
  ),

  http.get(`${API}/finance/assets/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        { id: "asset-1", shop: "shop-1", name: "MacBook Pro", category: "Electronics",
          asset_code: "ASSET-001", purchase_date: "2024-06-01", purchase_cost: "120000.00",
          warranty_expiry: "2027-06-01", condition: "good", location_description: "Main Office",
          notes: "", is_active: true },
      ],
    })
  ),

  http.post(`${API}/finance/assets/`, () =>
    HttpResponse.json({ success: true, data: { id: "asset-new" } }, { status: 201 })
  ),

  http.patch(`${API}/finance/assets/:id/`, () =>
    HttpResponse.json({ success: true, data: { id: "asset-1", condition: "fair" } })
  ),

  // ── Platform Admin ─────────────────────────────────────────────────────────

  http.get(`${API}/platform/tenants/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        { id: "tenant-1", name: "Tech Repairs Pvt Ltd", slug: "techrepairs",
          status: "active", plan: "professional", owner_email: "owner@techrepairs.in",
          owner_phone: "+919876543210", created_at: "2025-01-01T10:00:00Z" },
        { id: "tenant-2", name: "QuickFix Solutions", slug: "quickfix",
          status: "suspended", plan: "starter", owner_email: "admin@quickfix.in",
          owner_phone: "+919999999999", created_at: "2025-02-15T10:00:00Z" },
      ],
    })
  ),

  http.get(`${API}/platform/tenants/:id/`, ({ params }) =>
    HttpResponse.json({
      success: true,
      data: {
        id: params.id, name: "Tech Repairs Pvt Ltd", slug: "techrepairs",
        status: "active", plan: "professional",
        owner_email: "owner@techrepairs.in", owner_phone: "+919876543210",
        created_at: "2025-01-01T10:00:00Z", updated_at: "2025-01-15T10:00:00Z",
        db_status: "active",
        subscription: {
          id: "sub-1", status: "active",
          plan: { id: "plan-1", name: "Professional", max_shops: 3, max_users: 20, price_monthly_inr: "2999.00" },
          current_period_start: "2025-01-01", current_period_end: "2025-12-31",
        },
      },
    })
  ),

  http.post(`${API}/platform/tenants/:id/suspend/`, () =>
    HttpResponse.json({ success: true, data: { status: "suspended" } })
  ),

  http.get(`${API}/platform/plans/`, () =>
    HttpResponse.json({
      success: true,
      data: [
        { id: "plan-1", name: "Starter", max_shops: 1, max_users: 5,
          max_products: 200, max_jobs_per_month: 100, features: { whatsapp: false, reports: true },
          price_monthly_inr: "999.00" },
        { id: "plan-2", name: "Professional", max_shops: 3, max_users: 20,
          max_products: 1000, max_jobs_per_month: 500, features: { whatsapp: true, reports: true },
          price_monthly_inr: "2999.00" },
        { id: "plan-3", name: "Enterprise", max_shops: 0, max_users: 0,
          max_products: 0, max_jobs_per_month: 0, features: { whatsapp: true, reports: true, api: true },
          price_monthly_inr: "9999.00" },
      ],
    })
  ),

  // ── Reports ────────────────────────────────────────────────────────────────

  http.get(`${API}/reports/dashboard/`, () =>
    HttpResponse.json({
      success: true,
      data: {
        jobs_today_by_status: { repair: 3, ready: 2 },
        revenue_today: "5000.00",
        outstanding_dues: "25000.00",
        amc_visits_this_week: 4,
        low_stock_alerts: 2,
        contracts_expiring_this_month: 1,
        budget_heads_over_limit: 0,
      },
    })
  ),

  http.get(`${API}/reports/:reportType/`, () =>
    HttpResponse.json({
      success: true,
      data: {
        total: "50000.00",
        rows: [{ date: "2025-01-01", amount: "5000.00", method: "cash" }],
      },
    })
  ),
];
