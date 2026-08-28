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
  if (allowedOrigin && origin === allowedOrigin) {
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
function supabaseHeaders(env, extra = {}) {
  return {
    "apikey": env.SUPABASE_PUBLISHABLE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
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
      publishableKeyConfigured: Boolean(
        env.SUPABASE_PUBLISHABLE_KEY
      )
    });
  }
  // GET PRODUCTS
  if (
    request.method === "GET" &&
    url.pathname === "/api/products"
  ) {
    if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
      return json(
        {
          ok: false,
          error: "Supabase is not configured."
        },
        500
      );
    }
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/products?select=*`,
      {
        headers: supabaseHeaders(env)
      }
    );
    const text = await response.text();
    if (!response.ok) {
      console.error("Supabase GET products error:", text);
      return json(
        {
          ok: false,
          error: "Unable to load products from Supabase.",
          details: text
        },
        response.status
      );
    }
    let products = [];
    try {
      products = JSON.parse(text);
    } catch {
      return json(
        {
          ok: false,
          error: "Supabase returned invalid product data."
        },
        500
      );
    }
    return json({
      ok: true,
      products: Array.isArray(products) ? products : []
    });
  }
  // CREATE PRODUCT
  if (
    request.method === "POST" &&
    url.pathname === "/api/products"
  ) {
    if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
      return json(
        {
          ok: false,
          error: "Supabase is not configured."
        },
        500
      );
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return json(
        {
          ok: false,
          error: "Invalid JSON request body."
        },
        400
      );
    }
    const product = {
      name: body.name,
      description: body.description || "",
      category: body.category || "",
      price: Number(body.price),
      stock: Number(body.stock || 0),
      unit: body.unit || "",
      image_url: body.image_url || "",
      seller_id: body.seller_id || null
    };
    if (!product.name) {
      return json(
        {
          ok: false,
          error: "Product name is required."
        },
        400
      );
    }
    if (!Number.isFinite(product.price) || product.price < 0) {
      return json(
        {
          ok: false,
          error: "A valid product price is required."
        },
        400
      );
    }
    if (!Number.isFinite(product.stock) || product.stock < 0) {
      return json(
        {
          ok: false,
          error: "A valid stock quantity is required."
        },
        400
      );
    }
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/products`,
      {
        method: "POST",
        headers: supabaseHeaders(env, {
          "Prefer": "return=representation"
        }),
        body: JSON.stringify(product)
      }
    );
    const text = await response.text();
    if (!response.ok) {
      console.error("Supabase CREATE product error:", text);
      return json(
        {
          ok: false,
          error: "Unable to create product.",
          details: text
        },
        response.status
      );
    }
    let created;
    try {
      created = JSON.parse(text);
    } catch {
      return json(
        {
          ok: false,
          error: "Product was created, but Supabase returned an invalid response."
        },
        500
      );
    }
    return json({
      ok: true,
      product: Array.isArray(created) ? created[0] : created
    }, 201);
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
      const cors = corsHeaders(origin, env);
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
        const response = await handleApi(
          request,
          env
        );
        const headers = new Headers(
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
            error: "Static asset binding is not configured."
          },
          500
        );
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(
        "Unhandled Worker error:",
        error
      );
      return json(
        {
          ok: false,
          error: "Internal server error"
        },
        500
      );
    }
  }
};
