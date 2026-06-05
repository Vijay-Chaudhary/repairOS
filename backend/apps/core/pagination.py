from rest_framework.pagination import CursorPagination
from rest_framework.response import Response


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
