# Grok flight MCP workflow

This is the request the case screen sends when Grok revises a flight algorithm. The algorithm itself is the CCSDS OEM in [flight-algorithm-oem.md](flight-algorithm-oem.md). The model proposes that file. It does not fly the rocket, and its weights do not change.

xAI's Responses API connects to a remote MCP server for you. The route puts the block below in `tools`. Streaming HTTP and SSE are the only transports that connect. A stdio server on a laptop will not.

Reference: [Remote MCP tools](https://docs.x.ai/developers/tools/remote-mcp). `server_url` and `server_label` are required. The native SDK calls the allow-list `allowed_tool_names`. The Responses API calls it `allowed_tools`. `require_approval` and `connector_id` are not supported.

## What the route sends

`POST https://api.x.ai/v1/responses`

`XAI_API_KEY` stays on the server. The browser never sees it.

```json
{
  "model": "grok-4.7",
  "input": [
    { "role": "system", "content": "<instructions below>" },
    { "role": "user", "content": "<the editor's request, plus the working OEM if one exists>" }
  ],
  "tools": [
    {
      "type": "file_search",
      "vector_store_ids": ["<this case's train collection>"],
      "max_num_results": 20
    },
    {
      "type": "mcp",
      "server_url": "<FLIGHT_MCP_URL>",
      "server_label": "flight",
      "server_description": "Validates a CCSDS OEM 3.0 trajectory and scores one reduced orbit for chip lifetime. It does not propagate the rocket and it cannot see holdout outcomes.",
      "allowed_tools": ["validate_oem", "submit_oem", "score_candidate"]
    }
  ]
}
```

Pin a Grok 4-family model that supports remote MCP and `file_search`. `grok-4.7` is the model the remote-MCP guide uses. Holdout records are not in this collection. Withholding them from the store is the guarantee. A prompt line is not.

Retrieval is per case, so one chip's records do not bleed into another case. Putting the case's structured train records directly in the user message is also allowed. Either way, Grok is reading. Collections do not train the model.

## Instructions

Send these as the system input, with the case id filled in:

1. Read this case's train records before writing a trajectory. Use them to choose a path that prolongs the life of the selected chips.
2. The only flight artifact is a CCSDS OEM 3.0 keyword-value file: `REF_FRAME = GCRF`, `CENTER_NAME = EARTH`, `TIME_SYSTEM = UTC`, `ORIGINATOR = 3ROK`, position in km, velocity in km/s. At least two state lines. Acceleration in km/s² is optional and must be on every line of a segment or on none.
3. Call `validate_oem` on a draft. Call `submit_oem` only with a file that validates. The file you submit is the candidate. Prose is not the flight.
4. Do not put thrust, mass, a pitch program, or a chip lifetime in the file, including in `COMMENT` lines.
5. You may call `score_candidate` to compare reduced orbits. Those figures are estimates from the lifespan model. Do not copy them into the OEM as if they were states, and do not invent a figure the tool did not return.
6. If `score_candidate` refuses the orbit, leave that orbit. Do not fill in a lifetime yourself.
7. Do not claim the candidate is the optimized algorithm. The evaluator decides that after this request, on records you do not have.

## Tools the flight server exposes

`allowed_tools` is the whole surface. Do not leave it empty. An empty list injects every tool on the server into the prompt.

### `validate_oem`

Checks one OEM string against the profile in [flight-algorithm-oem.md](flight-algorithm-oem.md). It does not store the file and it does not score chip life.

```json
{
  "name": "validate_oem",
  "description": "Validate a CCSDS OEM 3.0 KVN trajectory against the 3rok profile. Returns errors. Does not store the file.",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["oem"],
    "properties": {
      "oem": {
        "type": "string",
        "description": "Full OEM keyword-value text, including the version header."
      }
    }
  }
}
```

Result:

```json
{
  "valid": true,
  "errors": [],
  "segment_count": 1,
  "state_count": 2,
  "start_time": "2026-10-03T18:05:00.000",
  "stop_time": "2026-10-03T18:20:00.000",
  "has_acceleration": false
}
```

`errors` lists profile failures in plain language: wrong frame, missing header keyword, fewer than two states, acceleration on some lines only, a time that goes backwards inside a segment.

### `submit_oem`

Same check as `validate_oem`. On success the server holds this text as the candidate for the current request. On failure it stores nothing and returns the errors. The route then runs the holdout check itself. This tool does not mark a file optimized.

```json
{
  "name": "submit_oem",
  "description": "Validate an OEM and, if it passes, hold it as the candidate trajectory for this request. Does not publish it and does not see holdout data.",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["oem"],
    "properties": {
      "oem": { "type": "string" }
    }
  }
}
```

The route treats the last accepted `submit_oem` as the candidate. An OEM that appears only in the chat is ignored. After the response, the route validates that text again in-process. A model claim that the tool succeeded is not the check.

### `score_candidate`

Maps one-to-one onto `starmind_physics.evaluate`. It scores a reduced orbit. It does not accept epochs, position, or velocity, and it does not return a trajectory.

The package ranks LEO compute-satellite configs inside a filed envelope of 500–2000 km and an inclination of about 30° or sun-synchronous. Outside that envelope the tool returns `refused: true` and no lifetime. Coefficients are marked sourced or assumed in `params.yaml`. The result is a ranking under those assumptions, not a Starmind or Rubin flight lifetime.

```json
{
  "name": "score_candidate",
  "description": "Score one reduced LEO orbit for chip lifetime, mean power, radiator area, and shield mass. Refuses orbits outside 500–2000 km and outside inclination 30 degrees or sun-synchronous. Does not propagate a trajectory.",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["altitude_km", "inclination", "ltan_hours", "shield_mm_Al"],
    "properties": {
      "altitude_km": { "type": "number" },
      "inclination": {
        "description": "\"sso\" or 30.",
        "anyOf": [
          { "type": "string", "enum": ["sso"] },
          { "type": "number" }
        ]
      },
      "ltan_hours": { "type": "number" },
      "shield_mm_Al": { "type": "number" },
      "chip_id": { "type": "string" },
      "chip_preset": { "type": "string", "enum": ["commercial", "rad_hard"] },
      "radiator_area_m2": { "type": ["number", "null"] },
      "load_strategy": { "type": "string", "enum": ["constant"] }
    }
  }
}
```

One of `chip_id` or `chip_preset` is required. `radiator_area_m2: null` asks the model to size the radiator. `load_strategy` defaults to `constant`.

Result when the orbit is inside the envelope:

```json
{
  "refused": false,
  "lifetime_years": 0,
  "mean_power_kW": 0,
  "radiator_area_m2": 0,
  "shield_mass_kg": 0,
  "limiting_mode": "TID",
  "breakdown": {},
  "value_status": "derived"
}
```

The zeros stand in for the shape. The live tool returns the package's numbers. `lifetime_years` is the minimum of the TID, thermal, power, and SEU-availability lives, which the package marks as an assumed definition.

## What happens after the response

The route, not the model, does the rest:

1. Take the last OEM `submit_oem` accepted. If there is none, the revision fails and the log says so.
2. Validate it again with the same profile, in-process.
3. Score it with the holdout outcomes (`split = holdout`). Keep it only when that error drops. The holdout function is not an MCP tool.
4. Append the instructions, the candidate, the score, and kept-or-rejected to the case log.
5. Replace the optimized OEM only when the revision is kept. A hand edit still does not overwrite it.
6. The testing page imports that file later. It samples the OEM. It does not call this route to move the marker.

## Server

`FLIGHT_MCP_URL` is an HTTPS streaming-HTTP or SSE endpoint. The xAI API opens it and prefixes calls as `flight.validate_oem`, `flight.submit_oem`, and `flight.score_candidate`. Usage reports server-side MCP tool calls. Send a bearer token in `authorization` when the server is not public.

`score_candidate` is the only tool that calls `starmind_physics.evaluate`. `validate_oem` and `submit_oem` are pure checks of the text. They do not import the physics package.

Until that URL is deployed, the route still validates and submits in-process with the same schemas, and it omits the `mcp` entry rather than pointing Grok at a dead server. `file_search` stays. The payload above is what the route sends once `FLIGHT_MCP_URL` is set.
