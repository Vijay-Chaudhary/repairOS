from django.contrib.auth.backends import ModelBackend

from .models import User


class EmailBackend(ModelBackend):
    """Authenticate with email (not username)."""

    def authenticate(self, request, email: str = None, password: str = None, **kwargs):
        if email is None or password is None:
            return None
        try:
            user = User.objects.get(email=email.lower())
        except User.DoesNotExist:
            User().set_password(password)  # Constant-time — avoids timing oracle
            return None
        if user.check_password(password):
            return user
        return None

    def get_user(self, user_id):
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None
