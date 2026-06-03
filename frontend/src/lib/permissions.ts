/**
 * Permission catalogue — mirrors the backend codenames exactly.
 * Keep in sync with: backend/apps/master/management/commands/create_tenant.py
 */

export const PERMISSIONS = {
  // CRM
  CRM_LEADS_VIEW:          "crm.leads.view",
  CRM_LEADS_CREATE:        "crm.leads.create",
  CRM_CUSTOMERS_VIEW:      "crm.customers.view",
  CRM_CUSTOMERS_CREATE:    "crm.customers.create",
  CRM_CUSTOMERS_EDIT:      "crm.customers.edit",
  CRM_CUSTOMERS_MERGE:     "crm.customers.merge",
  CRM_COMMS_LOG:           "crm.communications.log",
  CRM_TASKS_MANAGE:        "crm.tasks.manage",

  // Repair
  REPAIR_JOBS_VIEW:        "repair.jobs.view",
  REPAIR_JOBS_CREATE:      "repair.jobs.create",
  REPAIR_JOBS_EDIT:        "repair.jobs.edit",
  REPAIR_JOBS_STATUS:      "repair.jobs.change_status",
  REPAIR_JOBS_ASSIGN:      "repair.jobs.assign_tech",
  REPAIR_ESTIMATES_SEND:   "repair.estimates.send",
  REPAIR_ESTIMATES_APPROVE:"repair.estimates.approve",
  REPAIR_PARTS_REQUEST:    "repair.spare_parts.request",
  REPAIR_PARTS_APPROVE:    "repair.spare_parts.approve",
  REPAIR_WARRANTY_VIEW:    "repair.warranty.view",

  // POS
  POS_COUNTER_SALE:        "pos.counter_sale.create",
  POS_WHOLESALE_SALE:      "pos.wholesale_sale.create",
  POS_DISCOUNT:            "pos.discount.apply",
  POS_RETURNS:             "pos.returns.create",
  POS_RETURNS_APPROVE:     "pos.returns.approve",

  // Inventory / ERP
  ERP_INVENTORY_VIEW:      "erp.inventory.view",
  ERP_INVENTORY_ADJUST:    "erp.inventory.adjust",
  ERP_PROCUREMENT_VIEW:    "erp.procurement.view",
  ERP_PROCUREMENT_CREATE:  "erp.procurement.create",
  ERP_SUPPLIERS_MANAGE:    "erp.suppliers.manage",
  ERP_ASSETS_MANAGE:       "erp.assets.manage",
  ERP_EXPENSES_MANAGE:     "erp.expenses.manage",
  ERP_BUDGETS_MANAGE:      "erp.budgets.manage",

  // AMC
  AMC_CONTRACTS_VIEW:      "amc.contracts.view",
  AMC_CONTRACTS_CREATE:    "amc.contracts.create",
  AMC_CONTRACTS_EDIT:      "amc.contracts.edit",
  AMC_VISITS_SCHEDULE:     "amc.visits.schedule",
  AMC_VISITS_COMPLETE:     "amc.visits.complete",
  AMC_RENEWALS_MANAGE:     "amc.renewals.manage",

  // HR
  HR_EMPLOYEES_VIEW:       "hr.employees.view",
  HR_EMPLOYEES_MANAGE:     "hr.employees.manage",
  HR_ATTENDANCE_VIEW:      "hr.attendance.view",
  HR_ATTENDANCE_MARK:      "hr.attendance.mark",
  HR_LEAVES_MANAGE:        "hr.leaves.manage",
  HR_SALARY_VIEW:          "hr.salary.view",
  HR_SALARY_GENERATE:      "hr.salary.generate",
  HR_PETTY_CASH:           "hr.petty_cash.manage",

  // Billing
  BILLING_INVOICES_VIEW:   "billing.repair_invoices.view",
  BILLING_INVOICES_CREATE: "billing.repair_invoices.create",
  BILLING_SALES_VIEW:      "billing.sales_invoices.view",
  BILLING_PAYMENTS_RECORD: "billing.payments.record",
  BILLING_OUTSTANDING_VIEW:"billing.outstanding.view",
  BILLING_TALLY_EXPORT:    "billing.tally_export",

  // Reports (backend uses reports.<module>.view where module = registry key)
  REPORTS_BILLING:         "reports.billing.view",
  REPORTS_ERP:             "reports.erp.view",
  REPORTS_REPAIR:          "reports.repair.view",
  REPORTS_HR:              "reports.hr.view",
  REPORTS_CRM:             "reports.crm.view",
  REPORTS_AMC:             "reports.amc.view",
  REPORTS_REVENUE:         "reports.revenue.view",
  REPORTS_INVENTORY:       "reports.inventory.view",
  REPORTS_GST:             "reports.gst.view",
  REPORTS_PL:              "reports.pl.view",

  // Platform Admin
  PLATFORM_ADMIN:          "platform.admin",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
