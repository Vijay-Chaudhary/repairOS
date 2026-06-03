import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test-utils";
import InventoryPage from "@/app/(dashboard)/inventory/page";
import { http, HttpResponse } from "msw";
import { server } from "./mocks/server";

const API = "http://localhost/api/v1";

describe("Inventory page", () => {
  it("renders product name and SKU", async () => {
    renderWithProviders(<InventoryPage />);
    await waitFor(() => {
      expect(screen.getByText("iPhone Screen")).toBeInTheDocument();
      expect(screen.getByText(/SCRI13/)).toBeInTheDocument();
    });
  });

  it("shows variant count and brand", async () => {
    renderWithProviders(<InventoryPage />);
    await waitFor(() => {
      expect(screen.getByText(/1 variant/)).toBeInTheDocument();
      expect(screen.getByText(/Apple/)).toBeInTheDocument();
    });
  });

  it("expands product row to show variant details", async () => {
    renderWithProviders(<InventoryPage />);
    await waitFor(() => screen.getByText("iPhone Screen"));
    const user = userEvent.setup();
    await user.click(screen.getByText("iPhone Screen"));
    await waitFor(() => {
      expect(screen.getByText("Original")).toBeInTheDocument();
      expect(screen.getByText(/4,500/)).toBeInTheDocument();
    });
  });

  it("shows Add Product and Import buttons for users with adjust permission", async () => {
    renderWithProviders(<InventoryPage />);
    await waitFor(() => {
      expect(screen.getByText("Add Product")).toBeInTheDocument();
      expect(screen.getByText("Import")).toBeInTheDocument();
    });
  });

  it("shows empty state when no products", async () => {
    server.use(
      http.get(`${API}/inventory/products/`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { next_cursor: null, prev_cursor: null },
        })
      )
    );
    renderWithProviders(<InventoryPage />);
    await waitFor(() => {
      expect(screen.getByText("No products found")).toBeInTheDocument();
    });
  });

  it("shows low-stock product in the list", async () => {
    server.use(
      http.get(`${API}/inventory/products/`, () =>
        HttpResponse.json({
          success: true,
          data: [{
            id: "prod-low", category: null, name: "Low Stock Item", sku: "LSI-001",
            brand: null, description: null, hsn_code: null, default_tax_rate: "18.00",
            is_for_sale: true, is_for_repair_use: false, is_active: true,
            variants: [{
              id: "var-low", product: "prod-low", variant_name: "Default",
              sku: "LSI-001-D", buying_price: "100.00", selling_price: "200.00",
              gst_rate: "18.00", hsn_code: null, reorder_level: 5,
              stock_qty: 1, created_at: "2025-01-01T00:00:00Z",
            }],
            created_at: "2025-01-01T00:00:00Z",
          }],
          meta: { next_cursor: null, prev_cursor: null },
        })
      )
    );
    renderWithProviders(<InventoryPage />);
    await waitFor(() => {
      expect(screen.getByText("Low Stock Item")).toBeInTheDocument();
    });
  });
});
