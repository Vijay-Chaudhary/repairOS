from rest_framework.renderers import JSONRenderer


class RepairOSRenderer(JSONRenderer):
    """
    Wraps every response in the RepairOS envelope:

        Success (single):  {"success": true, "data": <payload>}
        Success (list):    {"success": true, "data": {"items": [...], "meta": {...}}}
        Error:             {"success": false, "error": <payload>}

    Paginated list views produce {"items": [...], "meta": {...}} from the
    paginator; the renderer wraps that object as `data` so the client
    consistently receives the full list payload under `data`.
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
            envelope = {"success": True, "data": data}

        return super().render(envelope, accepted_media_type, renderer_context)
