from rest_framework.pagination import CursorPagination, PageNumberPagination
from rest_framework.response import Response


class RepairOSPageNumberPagination(PageNumberPagination):
    """
    Page-number pagination returning:
        {"items": [...], "meta": {"count": N, "total_pages": P, "page": n, "page_size": 20}}
    """

    page_size = 20
    page_query_param = "page"
    page_size_query_param = "page_size"
    max_page_size = 200

    def get_paginated_response(self, data):
        return Response(
            {
                "items": data,
                "meta": {
                    "count": self.page.paginator.count,
                    "total_pages": self.page.paginator.num_pages,
                    "page": self.page.number,
                    "page_size": self.get_page_size(self.request),
                },
            }
        )

    def get_paginated_response_schema(self, schema):
        return {
            "type": "object",
            "properties": {
                "items": schema,
                "meta": {
                    "type": "object",
                    "properties": {
                        "count": {"type": "integer"},
                        "total_pages": {"type": "integer"},
                        "page": {"type": "integer"},
                        "page_size": {"type": "integer"},
                    },
                },
            },
        }


class RepairOSCursorPagination(CursorPagination):
    """
    Cursor-based pagination returning the envelope shape:
        {"data": [...], "meta": {"next_cursor": "...", "prev_cursor": "..."}}

    The renderer then wraps this in {"success": true, ...}.
    """

    page_size = 20
    ordering = "-created_at"
    cursor_query_param = "cursor"

    def get_paginated_response(self, data):
        return Response(
            {
                "items": data,
                "meta": {
                    "next_cursor": self.get_next_link(),
                    "prev_cursor": self.get_previous_link(),
                },
            }
        )

    def get_paginated_response_schema(self, schema):
        return {
            "type": "object",
            "properties": {
                "items": schema,
                "meta": {
                    "type": "object",
                    "properties": {
                        "next_cursor": {"type": "string", "nullable": True},
                        "prev_cursor": {"type": "string", "nullable": True},
                    },
                },
            },
        }
