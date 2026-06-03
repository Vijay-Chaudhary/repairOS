"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Users, Phone, MapPin } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import type { Customer, PaginatedResponse } from "@/types/crm";

async function fetchCustomers(
  search: string,
  page: number
): Promise<PaginatedResponse<Customer>> {
  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set("search", search);
  const res = await api.get(`/crm/customers/?${params}`);
  return res.data.data;
}

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["customers", search, page],
    queryFn: () => fetchCustomers(search, page),
    placeholderData: (prev) => prev,
  });

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500">{data?.count ?? 0} total</p>
        </div>
        <Link
          href="/customers/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          Add Customer
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name, phone…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Customer list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : data?.results?.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No customers found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data?.results?.map((customer) => (
            <CustomerCard key={customer.id} customer={customer} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.count > 20 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={!data.previous}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition min-h-[44px]"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">Page {page}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!data.next}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition min-h-[44px]"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function CustomerCard({ customer }: { customer: Customer }) {
  const outstanding = parseFloat(customer.total_outstanding);

  return (
    <Link
      href={`/customers/${customer.id}`}
      className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition"
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
          <span className="text-blue-700 font-semibold text-sm">
            {customer.name.charAt(0).toUpperCase()}
          </span>
        </div>

        {/* Details */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium text-gray-900 text-sm truncate">{customer.name}</p>
            {customer.customer_type === "business" && (
              <span className="text-xs px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded font-medium">
                Business
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Phone className="w-3 h-3" />
              {customer.phone}
            </span>
            {customer.city && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <MapPin className="w-3 h-3" />
                {customer.city}
              </span>
            )}
          </div>
          {customer.tags.length > 0 && (
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {customer.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-semibold text-gray-900">{customer.total_jobs} jobs</p>
          {outstanding > 0 && (
            <p className="text-xs text-red-500 font-medium mt-0.5">
              ₹{formatCurrency(outstanding)} due
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
