from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services


class SearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        token = getattr(request, "auth", None)
        results = services.global_search(request.query_params.get("q", ""), token)
        return Response({"results": results})
