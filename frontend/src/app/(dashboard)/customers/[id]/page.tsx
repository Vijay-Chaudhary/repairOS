"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Phone, Mail, MapPin, Wrench, Receipt, User } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Customer } from "@/types/crm";

async function fetchCustomer(id: string): Promise<Customer> {
  const res = await api.get(`/crm/customers/${id}/`);
  return res.data.data;
}

export default function CustomerDetailPage({ params }: { params: { id: string } }) {
  const { data: customer, isLoading } = useQuery({
    queryKey: ["customer", params.id],
    queryFn: () => fetchCustomer(params.id),
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-40 bg-gray-200 rounded" />
        <div className="h-32 bg-gray-100 rounded-xl" />
        <div className="h-24 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  if (!customer) return <p className="text-gray-500">Customer not found.</p>;

  const outstanding = parseFloat(customer.total_outstanding);
  const billed = parseFloat(customer.total_billed);

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Back */}
      <Link
        href="/customers"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="w-4 h-4" />
        Customers
      </Link>

      {/* Profile card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <span className="text-blue-700 font-bold text-xl">
              {customer.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-semibold text-gray-900">{customer.name}</h1>
              {customer.customer_type === "business" && (
                <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-medium">
                  Business
                </span>
              )}
              {outstanding > 0 && (
                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">
                  ₹{formatCurrency(outstanding)} due
                </span>
              )}
            </div>
            <div className="space-y-1 mt-2">
              <a
                href={`tel:${customer.phone}`}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-blue-600 transition"
              >
                <Phone className="w-3.5 h-3.5" />
                {customer.phone}
              </a>
              {customer.email && (
                <a
                  href={`mailto:${customer.email}`}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-blue-600 transition"
                >
                  <Mail className="w-3.5 h-3.5" />
                  {customer.email}
                </a>
              )}
              {customer.city && (
                <p className="flex items-center gap-2 text-sm text-gray-500">
                  <MapPin className="w-3.5 h-3.5" />
                  {customer.address ? `${customer.address}, ` : ""}{customer.city}
                </p>
              )}
            </div>
            {customer.tags.length > 0 && (
              <div className="flex gap-1 mt-2 flex-wrap">
                {customer.tags.map((tag) => (
                  <span key={tag} className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2 mt-4">
          <Link
            href={`/repairs/new?customer=${customer.id}`}
            className="flex items-center justify-center gap-2 py-2.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 transition min-h-[44px]"
          >
            <Wrench className="w-4 h-4" />
            New Repair
          </Link>
          <Link
            href={`/billing?customer=${customer.id}`}
            className="flex items-center justify-center gap-2 py-2.5 bg-gray-50 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-100 transition min-h-[44px]"
          >
            <Receipt className="w-4 h-4" />
            View Bills
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatBox icon={<Wrench className="w-4 h-4 text-blue-600" />} label="Jobs" value={String(customer.total_jobs)} />
        <StatBox icon={<Receipt className="w-4 h-4 text-green-600" />} label="Billed" value={`₹${formatCurrency(billed)}`} />
        <StatBox icon={<User className="w-4 h-4 text-orange-600" />} label="Outstanding" value={`₹${formatCurrency(outstanding)}`} valueClass={outstanding > 0 ? "text-red-600" : undefined} />
      </div>

      {/* GSTIN */}
      {customer.gstin && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 mb-1">GSTIN</p>
          <p className="text-sm font-mono text-gray-900">{customer.gstin}</p>
        </div>
      )}

      {/* Metadata */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
        <Row label="Customer since" value={formatDate(customer.created_at)} />
        <Row label="Credit limit" value={`₹${formatCurrency(parseFloat(customer.credit_limit))}`} />
        <Row label="WhatsApp" value={customer.whatsapp_optout ? "Opted out" : "Active"} />
      </div>
    </div>
  );
}

function StatBox({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
      <div className="flex justify-center mb-1">{icon}</div>
      <p className={`text-base font-bold text-gray-900 ${valueClass ?? ""}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm text-gray-900">{value}</span>
    </div>
  );
}
