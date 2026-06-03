from django.urls import path

from .views import (
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
    path("otp/request/", OTPRequestView.as_view(), name="auth-otp-request"),
    path("otp/verify/", OTPVerifyView.as_view(), name="auth-otp-verify"),
    path("token/refresh/", TokenRefreshView.as_view(), name="auth-token-refresh"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("password/change/", PasswordChangeView.as_view(), name="auth-password-change"),
    path("me/", MeView.as_view(), name="auth-me"),
]
