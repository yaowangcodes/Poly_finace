FROM python:3.13-slim AS builder
WORKDIR /app
RUN python -m venv /app/.venv
COPY bedrock_portfolio/requirements.txt /tmp/requirements.txt
RUN /app/.venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

FROM python:3.13-slim
RUN useradd --system --uid 1001 appuser
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY bedrock_portfolio/portfolio_skill.py bedrock_portfolio/main.py bedrock_portfolio/conversation.py bedrock_portfolio/AGENT_INSTRUCTIONS.md /app/
COPY alphaforge_starter/*.csv /app/alphaforge_starter/
ENV PATH="/app/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER appuser
EXPOSE 8080
CMD ["python", "main.py"]
