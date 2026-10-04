# Build from the repository root:  docker build -f flight-mcp/Dockerfile -t 3rok-flight-mcp .
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

# starmind-physics first: flight-mcp imports it, and it is not on PyPI.
COPY starmind-physics /app/starmind-physics
COPY flight-mcp /app/flight-mcp
RUN pip install ./starmind-physics ./flight-mcp

RUN useradd --create-home --uid 10001 flight
USER flight

ENV PORT=8000
EXPOSE 8000
CMD ["flight-mcp"]
