def make_strict_schema(schema: dict) -> dict:
    """Recursively add additionalProperties: false to all object schemas,
    and mark all properties as required — needed for OpenAI structured outputs."""
    schema = dict(schema)
    # Defaults are local validation behavior, not part of model generation.
    # They are also invalid as siblings of $ref in Responses strict schemas.
    schema.pop("default", None)

    if "$defs" in schema:
        schema["$defs"] = {k: make_strict_schema(v) for k, v in schema["$defs"].items()}

    if schema.get("type") == "object":
        schema["additionalProperties"] = False
        if "properties" in schema:
            schema["required"] = list(schema["properties"].keys())
            schema["properties"] = {
                k: make_strict_schema(v) for k, v in schema["properties"].items()
            }

    if "anyOf" in schema:
        schema["anyOf"] = [make_strict_schema(s) for s in schema["anyOf"]]

    if schema.get("type") == "array" and "items" in schema:
        schema["items"] = make_strict_schema(schema["items"])

    return schema
