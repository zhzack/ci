"""Command-line entry point for the API server."""

import uvicorn


def run() -> None:
    uvicorn.run("mini_pipeline.server.app:app", host="0.0.0.0", port=8000)


if __name__ == "__main__":
    run()
