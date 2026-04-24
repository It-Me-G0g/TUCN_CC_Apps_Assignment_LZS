const {
  authenticate,
  jsonResponseWithCorrelation,
  normalizeError,
  preflightResponse,
} = require("../shared/auth");
const { emit, finishRequest, maskDeviceId, startRequest } = require("../shared/logging");

const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "../mockData.json");
const rawData = fs.readFileSync(dataPath);
const allData = JSON.parse(rawData);

module.exports = async function data(context, req) {
  const request = startRequest(context, req, "/api/data");

  if (req.method === "OPTIONS") {
    context.res = preflightResponse(request.correlationId);
    finishRequest(context, request, 204);
    return;
  }

  try {
    const auth = await authenticate(req);
    const { role, device_id } = auth.claims;

    let visibleData;

    if (role === "admin") {
      visibleData = allData;
    } else if (role === "user") {
      if (!device_id) {
        emit(context, "warn", "authz.denied", {
          correlationId: request.correlationId,
          path: "/api/data",
          code: "missing_device_id",
          role,
        });
        context.res = jsonResponseWithCorrelation(
          403,
          {
            error: "No device_id associated with this account",
          },
          request.correlationId
        );
        finishRequest(context, request, 403);
        return;
      }

      visibleData = allData.filter((item) => item.device_id === device_id);
    } else {
      emit(context, "warn", "authz.denied", {
        correlationId: request.correlationId,
        path: "/api/data",
        code: "unknown_role",
        role,
      });
      context.res = jsonResponseWithCorrelation(
        403,
        { error: "Insufficient permissions" },
        request.correlationId
      );
      finishRequest(context, request, 403);
      return;
    }

    emit(context, "info", "authz.allowed", {
      correlationId: request.correlationId,
      path: "/api/data",
      role,
      deviceIdMasked: maskDeviceId(device_id),
      returnedCount: visibleData.length,
    });

    context.res = jsonResponseWithCorrelation(
      200,
      {
        role,
        device_id,
        data: visibleData,
      },
      request.correlationId
    );
    finishRequest(context, request, 200);
  } catch (error) {
    const normalized = normalizeError(error);
    emit(context, normalized.status >= 500 ? "error" : "warn", "auth.failed", {
      correlationId: request.correlationId,
      path: "/api/data",
      code: normalized.code,
      reason: normalized.logMessage,
    });
    context.res = jsonResponseWithCorrelation(
      normalized.status,
      { error: normalized.clientMessage },
      request.correlationId
    );
    finishRequest(context, request, normalized.status);
  }
};
