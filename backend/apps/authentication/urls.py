from django.urls import path

from django.conf import settings

from .views import (
    DevOTPView,
    LoginView,
    LogoutView,
    MeView,
    OTPRequestView,
    OTPVerifyView,
    PasswordChangeView,
    TokenRefreshView,
)

urlpatterns = [
    path("login/", LoginView.as_view(), name="auth-login"),
    # Canonical routes
    path("otp/request/", OTPRequestView.as_view(), name="auth-otp-request"),
    path("otp/verify/", OTPVerifyView.as_view(), name="auth-otp-verify"),
    path("token/refresh/", TokenRefreshView.as_view(), name="auth-token-refresh"),
    # Frontend-compatible aliases (match what the Next.js client calls)
    path("send-otp/", OTPRequestView.as_view(), name="auth-send-otp"),
    path("verify-otp/", OTPVerifyView.as_view(), name="auth-verify-otp"),
    path("refresh/", TokenRefreshView.as_view(), name="auth-refresh"),
    # Common routes
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("password/change/", PasswordChangeView.as_view(), name="auth-password-change"),
    path("me/", MeView.as_view(), name="auth-me"),
]

if settings.DEBUG:
    urlpatterns += [
        path("dev/otp/", DevOTPView.as_view(), name="auth-dev-otp"),
    ]
