const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...SECURITY_HEADERS,
      ...extraHeaders
    }
  });
}

function corsHeaders(origin, env) {
  const allowedOrigin = env.ALLOWED_ORIGIN || "";

  if (
    allowedOrigin &&
    origin === allowedOrigin
  ) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
  }

  return {};
}

function isAllowedOrigin(request, env) {
  const allowedOrigin = env.ALLOWED_ORIGIN;

  if (!allowedOrigin) {
    return false;
  }

  return request.headers.get("Origin") === allowedOrigin;
}

async function handleApi(request, env) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({
      ok: true,
      service: "fashion-fabric-marketplace",
      environment: env.ENVIRONMENT || "production"
    });
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    return json({
      ok: true,
      databaseConfigured: Boolean(env.SUPABASE_URL),
      paymentsConfigured: Boolean(env.PAYMONGO_SECRET_KEY),
      chatbotConfigured: Boolean(env.VOICEFLOW_API_KEY)
    });
  }

  return json(
    {
      ok: false,
      error: "API endpoint not found"
    },
    404
  );
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      const origin = request.headers.get("Origin");

      const cors = corsHeaders(
        origin,
        env
      );

      if (request.method === "OPTIONS") {
        if (!isAllowedOrigin(request, env)) {
          return new Response(null, {
            status: 403,
            headers: SECURITY_HEADERS
          });
        }

        return new Response(null, {
          status: 204,
          headers: {
            ...SECURITY_HEADERS,
            ...cors
          }
        });
      }

      if (url.pathname.startsWith("/api/")) {
        if (
          origin &&
          !isAllowedOrigin(request, env)
        ) {
          return json(
            {
              ok: false,
              error: "Origin not allowed"
            },
            403
          );
        }

        const response =
          await handleApi(
            request,
            env
          );

        const headers =
          new Headers(
            response.headers
          );

        Object.entries(cors).forEach(
          ([key, value]) => {
            headers.set(key, value);
          }
        );

        return new Response(
          response.body,
          {
            status: response.status,
            headers
          }
        );
      }

      if (!env.ASSETS) {
        return json(
          {
            ok: false,
            error:
              "Static asset binding is not configured."
          },
          500
        );
      }

      return env.ASSETS.fetch(
        request
      );

    } catch (error) {
      console.error(
        "Unhandled Worker error:",
        error
      );

      return json(
        {
          ok: false,
          error:
            "Internal server error"
        },
        500
      );
    }
  }
};
