"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Smartphone, Shield } from "lucide-react";
import { useAuthStore } from "@/stores/auth.store";
import { cn } from "@/lib/utils";

// ── Validation schemas ────────────────────────────────────────────────────────

const phoneSchema = z.object({
  tenant_slug: z.string().min(2, "Shop slug is required"),
  phone: z
    .string()
    .regex(/^\+91[6-9]\d{9}$/, "Enter a valid Indian mobile number (+91XXXXXXXXXX)"),
});

const otpSchema = z.object({
  otp: z.string().length(6, "OTP must be 6 digits").regex(/^\d{6}$/, "OTP must be digits only"),
});

type PhoneForm = z.infer<typeof phoneSchema>;
type OtpForm = z.infer<typeof otpSchema>;

// ── Component ─────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();
  const { sendOtp, verifyOtp } = useAuthStore();

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phoneData, setPhoneData] = useState<PhoneForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  const phoneForm = useForm<PhoneForm>({ resolver: zodResolver(phoneSchema) });
  const otpForm = useForm<OtpForm>({ resolver: zodResolver(otpSchema) });

  const handleSendOtp = async (data: PhoneForm) => {
    setError(null);
    try {
      await sendOtp(data);
      setPhoneData(data);
      setStep("otp");
    } catch (err: unknown) {
      const msg = extractError(err, "Failed to send OTP. Check your phone number and shop slug.");
      setError(msg);
    }
  };

  const handleVerifyOtp = async (data: OtpForm) => {
    if (!phoneData) return;
    setError(null);
    try {
      await verifyOtp({ ...phoneData, otp: data.otp });
      router.replace("/dashboard");
    } catch (err: unknown) {
      const msg = extractError(err, "Invalid OTP. Please try again.");
      setError(msg);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <span className="text-white font-bold text-2xl">R</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">RepairOS</h1>
          <p className="text-gray-500 text-sm mt-1">Sign in to your shop</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {step === "phone" ? (
            <form onSubmit={phoneForm.handleSubmit(handleSendOtp)} className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Smartphone className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-medium text-gray-700">Enter your details</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Shop slug
                </label>
                <input
                  {...phoneForm.register("tenant_slug")}
                  type="text"
                  placeholder="your-shop"
                  autoCapitalize="none"
                  className={cn(
                    "w-full px-3 py-2.5 rounded-lg border text-sm outline-none transition",
                    "focus:ring-2 focus:ring-blue-500 focus:border-transparent",
                    phoneForm.formState.errors.tenant_slug
                      ? "border-red-300 bg-red-50"
                      : "border-gray-300 bg-white"
                  )}
                />
                {phoneForm.formState.errors.tenant_slug && (
                  <p className="text-red-500 text-xs mt-1">
                    {phoneForm.formState.errors.tenant_slug.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Mobile number
                </label>
                <input
                  {...phoneForm.register("phone")}
                  type="tel"
                  placeholder="+91XXXXXXXXXX"
                  className={cn(
                    "w-full px-3 py-2.5 rounded-lg border text-sm outline-none transition",
                    "focus:ring-2 focus:ring-blue-500 focus:border-transparent",
                    phoneForm.formState.errors.phone
                      ? "border-red-300 bg-red-50"
                      : "border-gray-300 bg-white"
                  )}
                />
                {phoneForm.formState.errors.phone && (
                  <p className="text-red-500 text-xs mt-1">
                    {phoneForm.formState.errors.phone.message}
                  </p>
                )}
              </div>

              {error && (
                <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={phoneForm.formState.isSubmitting}
                className="w-full py-2.5 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 min-h-[44px]"
              >
                {phoneForm.formState.isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Send OTP
              </button>
            </form>
          ) : (
            <form onSubmit={otpForm.handleSubmit(handleVerifyOtp)} className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-medium text-gray-700">Enter OTP</span>
              </div>
              <p className="text-xs text-gray-500">
                Sent to <strong>{phoneData?.phone}</strong>
              </p>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  6-digit OTP
                </label>
                <input
                  {...otpForm.register("otp")}
                  type="tel"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  autoFocus
                  className={cn(
                    "w-full px-3 py-2.5 rounded-lg border text-sm text-center tracking-widest outline-none transition",
                    "focus:ring-2 focus:ring-blue-500 focus:border-transparent",
                    otpForm.formState.errors.otp
                      ? "border-red-300 bg-red-50"
                      : "border-gray-300 bg-white"
                  )}
                />
                {otpForm.formState.errors.otp && (
                  <p className="text-red-500 text-xs mt-1">
                    {otpForm.formState.errors.otp.message}
                  </p>
                )}
              </div>

              {error && (
                <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={otpForm.formState.isSubmitting}
                className="w-full py-2.5 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2 min-h-[44px]"
              >
                {otpForm.formState.isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Verify &amp; Sign in
              </button>

              <button
                type="button"
                onClick={() => { setStep("phone"); setError(null); otpForm.reset(); }}
                className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition"
              >
                ← Change number
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Error extraction helper ───────────────────────────────────────────────────

function extractError(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null) {
    const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
    return axiosErr?.response?.data?.error?.message ?? fallback;
  }
  return fallback;
}
