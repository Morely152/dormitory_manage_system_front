from __future__ import annotations

from flask import Flask, jsonify, request

LOCAL_FRONTEND_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://172.27.67.28:5173"
}

try:
    from .solver.improver import improve_plan
    from .solver.planner import solve_plan
except ImportError:
    from solver.improver import improve_plan
    from solver.planner import solve_plan


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["JSON_AS_ASCII"] = False

    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get("Origin")
        if origin in LOCAL_FRONTEND_ORIGINS:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Vary"] = "Origin"
        return response

    @app.get("/api/allocation/v1/health")
    def health():
        return jsonify({"status": "ok", "engine": "allocation-mcmf-lns-sa/v1"})

    @app.post("/api/allocation/v1/solve")
    def solve():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "请求体必须是 JSON 对象", "snapshot": None, "diagnostics": None}), 400
        try:
            return jsonify(solve_plan(payload))
        except ValueError as error:
            return jsonify({"error": str(error), "snapshot": None, "diagnostics": None}), 400
        except Exception:
            app.logger.exception("allocation solver failed")
            return jsonify({"error": "排寝服务内部错误", "snapshot": None, "diagnostics": None}), 500

    @app.post("/api/allocation/v1/improve")
    def improve():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "请求体必须是 JSON 对象", "snapshot": None, "diagnostics": None}), 400
        try:
            return jsonify(improve_plan(payload))
        except ValueError as error:
            return jsonify({"error": str(error), "snapshot": None, "diagnostics": None}), 400
        except Exception:
            app.logger.exception("allocation improver failed")
            return jsonify({"error": "排寝优化服务内部错误", "snapshot": None, "diagnostics": None}), 500

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
