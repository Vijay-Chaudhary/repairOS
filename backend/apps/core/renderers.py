from rest_framework.renderers import JSONRenderer


class RepairOSRenderer(JSONRenderer):
    """
    Wraps every response in the RepairOS envelope:

        Success:  {"success": true,  "data": <payload>, "meta": {...}}
        Error:    {"success": false, "error": <payload>}

    The exception handler already shapes error payloads; the renderer just
    wraps them. For list responses with pagination, the paginator injects
    `meta` directly into the response dict before this renderer runs.
    """

    def render(self, data, accepted_media_type=None, renderer_context=None):
        if renderer_context is None:
            return super().render(data, accepted_media_type, renderer_context)

        response = renderer_context.get("response")
        if response is None:
            return super().render(data, accepted_media_type, renderer_context)

        status_code = response.status_code

        if status_code >= 400:
            envelope = {"success": False, "error": data}
        else:
            # Paginated list views set response.data as {"data": [...], "meta": {...}}
            if isinstance(data, dict) and "data" in data and "meta" in data:
                envelope = {"success": True, **data}
            else:
                envelope = {"success": True, "data": data}

        return super().render(envelope, accepted_media_type, renderer_context)
