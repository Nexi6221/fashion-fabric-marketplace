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
  const origin = request.headers.get("Origin");
  const requestUrl = new URL(request.url);

  if (origin === requestUrl.origin) {
    return true;
  }

  const allowedOrigin = env.ALLOWED_ORIGIN;

  if (!allowedOrigin) {
    return false;
  }

  return origin === allowedOrigin;
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

  // HEALTH
  if (
    request.method === "GET" &&
    url.pathname === "/api/health"
  ) {
    return json({
      ok: true,
      service: "fashion-fabric-marketplace",
      environment: env.ENVIRONMENT || "production"
    });
  }

  // STATUS
  if (
    request.method === "GET" &&
    url.pathname === "/api/status"
  ) {
    return json({
      ok: true,
      databaseConfigured: Boolean(env.SUPABASE_URL),
      publishableKeyConfigured: Boolean(
        env.SUPABASE_PUBLISHABLE_KEY
      ),
      payMongoConfigured: Boolean(
        env.PAYMONGO_SECRET_KEY
      ),
      geminiConfigured: Boolean(
        env.GEMINI_API_KEY
      )
    });
  }

  // GET PRODUCTS
  if (
    request.method === "GET" &&
    url.pathname === "/api/products"
  ) {
    if (
      !env.SUPABASE_URL ||
      !env.SUPABASE_PUBLISHABLE_KEY
    ) {
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
      console.error(
        "Supabase GET products error:",
        text
      );

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
      products: Array.isArray(products)
        ? products
        : []
    });
  }

  // CREATE PRODUCT
  if (
    request.method === "POST" &&
    url.pathname === "/api/products"
  ) {
    if (
      !env.SUPABASE_URL ||
      !env.SUPABASE_PUBLISHABLE_KEY
    ) {
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

    if (
      !Number.isFinite(product.price) ||
      product.price < 0
    ) {
      return json(
        {
          ok: false,
          error: "A valid product price is required."
        },
        400
      );
    }

    if (
      !Number.isFinite(product.stock) ||
      product.stock < 0
    ) {
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
      console.error(
        "Supabase CREATE product error:",
        text
      );

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
          error:
            "Product was created, but Supabase returned an invalid response."
        },
        500
      );
    }

    return json(
      {
        ok: true,
        product: Array.isArray(created)
          ? created[0]
          : created
      },
      201
    );
  }

  // CREATE PAYMONGO CHECKOUT
  if (
    request.method === "POST" &&
    url.pathname === "/api/create-checkout"
  ) {
    if (!env.PAYMONGO_SECRET_KEY) {
      return json(
        {
          ok: false,
          error:
            "PayMongo secret key is not configured."
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

    const name = String(body.name || "").trim();
    const price = Number(body.price);
    const quantity = Number(body.quantity || 1);

    if (
      !name ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return json(
        {
          ok: false,
          error:
            "Valid product information is required."
        },
        400
      );
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      return json(
        {
          ok: false,
          error: "Valid quantity is required."
        },
        400
      );
    }

    const origin =
      request.headers.get("Origin") ||
      "https://fashion-fabric-marketplace.sabrinaspellman62216221.workers.dev";

    const response = await fetch(
      "https://api.paymongo.com/v2/checkout_sessions",
      {
        method: "POST",
        headers: {
          "Authorization":
            `Basic ${btoa(
              env.PAYMONGO_SECRET_KEY + ":"
            )}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          data: {
            attributes: {
              line_items: [
                {
                  name: name,
                  amount: Math.round(price * 100),
                  currency: "PHP",
                  quantity: quantity
                }
              ],
              payment_method_types: [
                "card",
                "gcash",
                "qrph"
              ],
              success_url:
                `${origin}/?payment=success`,
              cancel_url:
                `${origin}/?payment=cancelled`
            }
          }
        })
      }
    );

    const text = await response.text();

    if (!response.ok) {
      console.error(
        "PayMongo error:",
        text
      );

      return json(
        {
          ok: false,
          error:
            "PayMongo checkout could not be created."
        },
        response.status
      );
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return json(
        {
          ok: false,
          error:
            "PayMongo returned invalid JSON."
        },
        500
      );
    }

    const checkoutUrl =
      data?.data?.attributes?.checkout_url;

    if (!checkoutUrl) {
      return json(
        {
          ok: false,
          error:
            "PayMongo did not return a checkout URL."
        },
        500
      );
    }

    return json({
      ok: true,
      checkoutUrl: checkoutUrl
    });
  }

  // PAYMONGO WEBHOOK
  if (
    request.method === "POST" &&
    url.pathname === "/api/paymongo-webhook"
  ) {
    let event;

    try {
      event = await request.json();
    } catch {
      return json(
        {
          ok: false,
          error: "Invalid webhook JSON."
        },
        400
      );
    }

    console.log(
      "PayMongo webhook received:",
      JSON.stringify(event)
    );

    const eventType =
      event?.data?.attributes?.type;

    if (
      eventType ===
      "checkout_session.payment.paid"
    ) {
      console.log(
        "PAYMENT PAID:",
        JSON.stringify(
          event?.data?.attributes?.data || {}
        )
      );
    }

    return json({
      ok: true,
      received: true
    });
  }

  // GEMINI AI CHAT
  if (
    request.method === "POST" &&
    url.pathname === "/api/chat"
  ) {
    if (!env.GEMINI_API_KEY) {
      return json(
        {
          ok: false,
          error: "Gemini API key is not configured."
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

    const message =
      String(body.message || "").trim();

    if (!message) {
      return json(
        {
          ok: false,
          error: "Message is required."
        },
        400
      );
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [
              {
                text:
                  "You are the Thread & Loom AI assistant for a fashion fabric marketplace. Help customers with fabrics, products, orders, and general shopping questions. Be friendly, concise, and helpful."
              }
            ]
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: message
                }
              ]
            }
          ]
        })
      }
    );

    const text = await response.text();

    if (!response.ok) {
      console.error(
        "Gemini API error:",
        text
      );

      return json(
        {
          ok: false,
          error: "Gemini API error.",
          details: text
        },
        response.status
      );
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return json(
        {
          ok: false,
          error: "Gemini returned invalid JSON."
        },
        500
      );
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) {
      return json(
        {
          ok: false,
          error: "Gemini returned no response."
        },
        500
      );
    }

    return json({
      ok: true,
      reply: reply
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
            error:
              "Static asset binding is not configured."
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