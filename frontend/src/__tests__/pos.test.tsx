import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test-utils";
import POSPage from "@/app/(dashboard)/pos/page";
import { http, HttpResponse } from "msw";
import { server } from "./mocks/server";

const API = "http://localhost/api/v1";

describe("POS Sale screen", () => {
  it("renders search bar and empty cart initially", () => {
    renderWithProviders(<POSPage />);
    expect(screen.getByPlaceholderText(/Search product/i)).toBeInTheDocument();
    expect(screen.getByText("Cart is empty")).toBeInTheDocument();
  });

  it("searches products and shows results", async () => {
    renderWithProviders(<POSPage />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search product/i), "iPhone");
    await waitFor(() => {
      expect(screen.getByText("iPhone Screen")).toBeInTheDocument();
    });
  });

  it("adds product to cart on click", async () => {
    renderWithProviders(<POSPage />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search product/i), "iPhone");
    await waitFor(() => screen.getByText("iPhone Screen"));
    await user.click(screen.getByText("iPhone Screen"));
    await waitFor(() => {
      expect(screen.getByText("Cart (1 items)")).toBeInTheDocument();
    });
  });

  it("shows Charge button after adding item to cart", async () => {
    renderWithProviders(<POSPage />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search product/i), "iPhone");
    await waitFor(() => screen.getByText("iPhone Screen"));
    await user.click(screen.getByText("iPhone Screen"));
    await waitFor(() => {
      expect(screen.getByText(/Charge/i)).toBeInTheDocument();
    });
  });

  it("shows payment methods after clicking charge", async () => {
    renderWithProviders(<POSPage />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search product/i), "iPhone");
    await waitFor(() => screen.getByText("iPhone Screen"));
    await user.click(screen.getByText("iPhone Screen"));
    await waitFor(() => screen.getByText(/Charge/i));
    await user.click(screen.getByText(/Charge/i));
    await waitFor(() => {
      expect(screen.getByText("CASH")).toBeInTheDocument();
      expect(screen.getByText("UPI")).toBeInTheDocument();
      expect(screen.getByText("CARD")).toBeInTheDocument();
    });
  });

  it("clears cart after successful sale", async () => {
    server.use(
      http.post(`${API}/pos/sales/`, () =>
        HttpResponse.json(
          { success: true, data: { id: "sale-1", sale_number: "SALE-001" } },
          { status: 201 }
        )
      )
    );
    renderWithProviders(<POSPage />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search product/i), "iPhone");
    await waitFor(() => screen.getByText("iPhone Screen"));
    await user.click(screen.getByText("iPhone Screen"));
    await waitFor(() => screen.getByText(/Charge/i));
    await user.click(screen.getByText(/Charge/i));
    await waitFor(() => screen.getByText("Confirm"));
    await user.click(screen.getByText("Confirm"));
    await waitFor(() => {
      expect(screen.getByText("Cart is empty")).toBeInTheDocument();
    });
  });
});
