import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test-utils";
import LoginPage from "@/app/(auth)/login/page";
import { http, HttpResponse } from "msw";
import { server } from "./mocks/server";

const API = "http://localhost/api/v1";

describe("Login page", () => {
  it("renders phone + slug form in step 1", () => {
    renderWithProviders(<LoginPage />);
    expect(screen.getByPlaceholderText("your-shop")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("+91XXXXXXXXXX")).toBeInTheDocument();
    expect(screen.getByText("Send OTP")).toBeInTheDocument();
  });

  it("shows validation error for invalid phone", async () => {
    renderWithProviders(<LoginPage />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("your-shop"), "demo");
    await user.type(screen.getByPlaceholderText("+91XXXXXXXXXX"), "12345");
    await user.click(screen.getByText("Send OTP"));
    await waitFor(() => {
      // Error: "Enter a valid Indian mobile number (+91XXXXXXXXXX)"
      expect(screen.getByText(/valid Indian mobile/i)).toBeInTheDocument();
    });
  });

  it("advances to OTP step after successful send-otp", async () => {
    server.use(
      http.post(`${API}/auth/send-otp/`, () =>
        HttpResponse.json({ success: true, data: {} })
      )
    );
    renderWithProviders(<LoginPage />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("your-shop"), "demo");
    await user.type(screen.getByPlaceholderText("+91XXXXXXXXXX"), "+919876543210");
    await user.click(screen.getByText("Send OTP"));
    await waitFor(() => {
      expect(screen.getByText(/Enter OTP/i)).toBeInTheDocument();
    });
  });

  it("shows OTP field and verify button in step 2", async () => {
    server.use(
      http.post(`${API}/auth/send-otp/`, () =>
        HttpResponse.json({ success: true, data: {} })
      )
    );
    renderWithProviders(<LoginPage />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("your-shop"), "demo");
    await user.type(screen.getByPlaceholderText("+91XXXXXXXXXX"), "+919876543210");
    await user.click(screen.getByText("Send OTP"));
    await waitFor(() => {
      expect(screen.getByPlaceholderText("000000")).toBeInTheDocument();
      expect(screen.getByText(/Verify/i)).toBeInTheDocument();
    });
  });

  it("shows API error on failed OTP send", async () => {
    server.use(
      http.post(`${API}/auth/send-otp/`, () =>
        HttpResponse.json(
          { success: false, error: { message: "Phone not registered" } },
          { status: 400 }
        )
      )
    );
    renderWithProviders(<LoginPage />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("your-shop"), "demo");
    await user.type(screen.getByPlaceholderText("+91XXXXXXXXXX"), "+919876543210");
    await user.click(screen.getByText("Send OTP"));
    await waitFor(() => {
      expect(screen.getByText(/Phone not registered/i)).toBeInTheDocument();
    });
  });
});
