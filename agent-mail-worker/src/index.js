/**
 * Cloudflare Email Routing Worker for Agent Mailbox & OTP extraction
 */

function bearer(request) {
  return (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
}

// Constant-time comparison. Hashing first makes both sides the same length,
// so neither the content nor the length of the secret leaks through timing.
async function secretEquals(provided, expected) {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// Helper to extract OTP code and verification URL from email text/subject
function extractOtpAndLinks(subject, bodyText) {
  const fullContent = `${subject}\n${bodyText}`;

  // Patterns for OTP / verification codes (4 to 8 digits)
  // 1. Look for explicit keywords nearby
  const keywordPattern = /(?:code|verification|passcode|security code|pin|otp|код|пароль|підтвердження)[^\n\r0-9]{1,30}(\b[0-9]{4,8}\b)/i;
  const matchKeyword = fullContent.match(keywordPattern);

  let otpCode = null;
  if (matchKeyword && matchKeyword[1]) {
    otpCode = matchKeyword[1];
  } else {
    // 2. Look for standalone 4-8 digit codes on their own line or enclosed in quotes/brackets
    const standalonePattern = /(?:^|\s|["':*`])([0-9]{4,8})(?:["':*`\s]|$)/m;
    const matchStandalone = fullContent.match(standalonePattern);
    if (matchStandalone && matchStandalone[1]) {
      otpCode = matchStandalone[1];
    }
  }

  // Look for verification / confirmation URLs
  const linkPattern = /(https?:\/\/[^\s"'<>()]+(?:verify|verification|confirm|confirmation|activate|auth|token|otp)[^\s"'<>()]*)/i;
  const matchLink = fullContent.match(linkPattern);
  const verificationLink = matchLink ? matchLink[1] : null;

  return { otpCode, verificationLink };
}

// Simple MIME / Body parser for incoming raw email
function parseRawEmail(rawText) {
  const parts = rawText.split(/\r?\n\r?\n/);
  const headerBlock = parts[0] || "";
  const bodyBlock = parts.slice(1).join("\n\n");

  // Basic cleanup of multipart boundaries or HTML tags for clean text preview
  let cleanBody = bodyBlock
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/=\r?\n/g, "") // quoted-printable soft breaks
    .replace(/\s+/g, " ")
    .trim();

  // If clean body is too short or empty, fall back to raw body text
  if (cleanBody.length < 5) {
    cleanBody = bodyBlock.substring(0, 4000);
  } else if (cleanBody.length > 8000) {
    cleanBody = cleanBody.substring(0, 8000);
  }

  return cleanBody;
}

export default {
  // 1. Email Handler — triggered when Cloudflare Email Routing catches a message
  async email(message, env, ctx) {
    const from = message.from;
    const to = message.to;
    const subject = message.headers.get("subject") || "(Без теми)";
    const receivedAt = new Date().toISOString();

    let rawEmail = "";
    try {
      rawEmail = await new Response(message.raw).text();
    } catch (err) {
      rawEmail = `Error reading raw stream: ${err.message}`;
    }

    const cleanBody = parseRawEmail(rawEmail);
    const { otpCode, verificationLink } = extractOtpAndLinks(subject, cleanBody);

    const normalizedTo = to.toLowerCase().trim();
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const storageKey = `msg:${normalizedTo}:${id}`;

    const emailRecord = {
      id,
      from,
      to: normalizedTo,
      subject,
      snippet: cleanBody.substring(0, 300),
      body: cleanBody,
      otp_code: otpCode,
      verification_link: verificationLink,
      received_at: receivedAt,
    };

    // Store in KV
    if (env.AG_MAILBOX) {
      // 1. Store full individual message
      await env.AG_MAILBOX.put(storageKey, JSON.stringify(emailRecord), {
        expirationTtl: 60 * 60 * 24 * 7, // 7 days retention
      });

      // 2. Update recipient inbox list for instant retrieval
      const inboxKey = `inbox:${normalizedTo}`;
      let currentInbox = [];
      try {
        currentInbox = (await env.AG_MAILBOX.get(inboxKey, "json")) || [];
      } catch (e) {
        currentInbox = [];
      }
      currentInbox.unshift(emailRecord);
      if (currentInbox.length > 50) {
        currentInbox = currentInbox.slice(0, 50);
      }
      await env.AG_MAILBOX.put(inboxKey, JSON.stringify(currentInbox), {
        expirationTtl: 60 * 60 * 24 * 7,
      });

      // 3. Update latest OTP index
      if (otpCode) {
        await env.AG_MAILBOX.put(
          `otp:${normalizedTo}`,
          JSON.stringify({
            code: otpCode,
            from,
            subject,
            link: verificationLink,
            received_at: receivedAt,
            msg_id: id,
          }),
          { expirationTtl: 60 * 60 * 24 } // 24 hours
        );
      }
    }

    // Agent emails (*@ag.waveio.me) are strictly isolated and NEVER forwarded to personal email.
    if (normalizedTo.endsWith("@ag.waveio.me")) {
      // Kept exclusively in AG_MAILBOX for agents and dashboard.
      return;
    }

    // Forward non-agent main domain emails (*@waveio.me) to owner's inbox if configured
    if (env.FORWARD_MAIN_DOMAIN_TO && env.FORWARD_MAIN_DOMAIN_TO !== normalizedTo) {
      try {
        await message.forward(env.FORWARD_MAIN_DOMAIN_TO);
      } catch (fwdErr) {
        console.error("Failed to forward main domain email to", env.FORWARD_MAIN_DOMAIN_TO, fwdErr);
      }
    }
  },

  // 2. Fetch Handler — REST API for Agent / Bot Dashboard to fetch emails and OTPs
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Standard CORS
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === "/api/health") {
      return Response.json(
        { status: "ok", service: "agent-mail-worker", time: new Date().toISOString() },
        { headers: corsHeaders }
      );
    }

    // If this is an agent send endpoint, let its dedicated handler perform agent token validation
    const isSendEndpoint = url.pathname === "/api/send" || url.pathname === "/v1/send";

    // General auth check for inbox / OTP management endpoints.
    // Fails closed: a Worker deployed without its secrets answers 503 instead
    // of silently letting everyone read every mailbox. The key is accepted
    // only in headers; a key in the query string ends up in access logs.
    if (!isSendEndpoint) {
      if (!env.API_KEY || !env.DEFAULT_AGENT_TOKEN) {
        return Response.json(
          { error: "Mail gateway secrets are not configured" },
          { status: 503, headers: corsHeaders }
        );
      }
      const providedKey = bearer(request) || request.headers.get("X-API-Key") || "";
      const allowed =
        (await secretEquals(providedKey, env.API_KEY)) ||
        (await secretEquals(providedKey, env.DEFAULT_AGENT_TOKEN));
      if (!allowed) {
        return Response.json(
          { error: "Unauthorized: invalid API key" },
          { status: 401, headers: corsHeaders }
        );
      }
    }


    // GET /api/inbox?to=lokzu@ag.waveio.me
    if (url.pathname === "/api/inbox" && request.method === "GET") {
      const to = (url.searchParams.get("to") || "").toLowerCase().trim();
      if (!to) {
        return Response.json({ error: "Missing ?to= parameter" }, { status: 400, headers: corsHeaders });
      }

      const inboxKey = `inbox:${to}`;
      const messages = (await env.AG_MAILBOX.get(inboxKey, "json")) || [];

      return Response.json(
        { to, count: messages.length, messages },
        { headers: corsHeaders }
      );
    }

    // GET /api/latest-otp?to=lokzu@ag.waveio.me
    if (url.pathname === "/api/latest-otp" && request.method === "GET") {
      const to = (url.searchParams.get("to") || "").toLowerCase().trim();
      if (!to) {
        return Response.json({ error: "Missing ?to= parameter" }, { status: 400, headers: corsHeaders });
      }

      const otpData = await env.AG_MAILBOX.get(`otp:${to}`, "json");
      return Response.json(
        { to, otp: otpData || null },
        { headers: corsHeaders }
      );
    }

    // POST /api/simulate-receive — test injection
    if (url.pathname === "/api/simulate-receive" && request.method === "POST") {
      try {
        const payload = await request.json();
        const from = payload.from || "service@example.com";
        const to = (payload.to || "lokzu@ag.waveio.me").toLowerCase().trim();
        const subject = payload.subject || "Verification code";
        const body = payload.body || "Your security code is 749201. Use it to complete registration.";
        const receivedAt = new Date().toISOString();

        const { otpCode, verificationLink } = extractOtpAndLinks(subject, body);
        const id = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const storageKey = `msg:${to}:${id}`;

        const emailRecord = {
          id,
          from,
          to,
          subject,
          snippet: body.substring(0, 300),
          body,
          otp_code: otpCode,
          verification_link: verificationLink,
          received_at: receivedAt,
        };

        await env.AG_MAILBOX.put(storageKey, JSON.stringify(emailRecord), {
          expirationTtl: 60 * 60 * 24 * 7,
        });

        // Update inbox list
        const inboxKey = `inbox:${to}`;
        let currentInbox = [];
        try {
          currentInbox = (await env.AG_MAILBOX.get(inboxKey, "json")) || [];
        } catch (e) {
          currentInbox = [];
        }
        currentInbox.unshift(emailRecord);
        if (currentInbox.length > 50) {
          currentInbox = currentInbox.slice(0, 50);
        }
        await env.AG_MAILBOX.put(inboxKey, JSON.stringify(currentInbox), {
          expirationTtl: 60 * 60 * 24 * 7,
        });

        if (otpCode) {
          await env.AG_MAILBOX.put(
            `otp:${to}`,
            JSON.stringify({
              code: otpCode,
              from,
              subject,
              link: verificationLink,
              received_at: receivedAt,
              msg_id: id,
            }),
            { expirationTtl: 60 * 60 * 24 }
          );
        }

        return Response.json(
          { success: true, message: "Simulated email received and saved", record: emailRecord },
          { headers: corsHeaders }
        );
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // DELETE /api/inbox?to=lokzu@ag.waveio.me
    if (url.pathname === "/api/inbox" && request.method === "DELETE") {
      const to = (url.searchParams.get("to") || "").toLowerCase().trim();
      await env.AG_MAILBOX.delete(`inbox:${to}`);
      await env.AG_MAILBOX.delete(`otp:${to}`);
      return Response.json({ success: true, message: "Inbox cleared" }, { headers: corsHeaders });
    }

    // POST /api/send or /v1/send — Secure outbound email gateway for AI agents
    if ((url.pathname === "/api/send" || url.pathname === "/v1/send") && request.method === "POST") {
      // 1. Validate agent token
      if (!env.DEFAULT_AGENT_TOKEN) {
        return Response.json(
          { error: "Mail gateway secrets are not configured" },
          { status: 503, headers: corsHeaders }
        );
      }
      const agentToken = bearer(request) || request.headers.get("X-Agent-Token") || "";
      
      if (!(await secretEquals(agentToken, env.DEFAULT_AGENT_TOKEN))) {
        return Response.json(
          { error: "Unauthorized: invalid agent token. The agent does not have permission to send emails." },
          { status: 401, headers: corsHeaders }
        );
      }

      // 2. Parse request payload from agent
      let payload = {};
      try {
        payload = await request.json();
      } catch (err) {
        return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
      }

      const to = (payload.to || "").trim();
      const subject = (payload.subject || "Message from AI Agent").trim();
      const body = payload.body || payload.text || "";
      const htmlBody = payload.html || "";

      if (!to || !to.includes("@")) {
        return Response.json({ error: "Missing or invalid recipient email ('to')" }, { status: 400, headers: corsHeaders });
      }
      if (!body && !htmlBody) {
        return Response.json({ error: "Email body or text cannot be empty" }, { status: 400, headers: corsHeaders });
      }

      // 3. Resolve agent identity
      const agentName = payload.sender_name || "Lokzu (AI Agent)";
      const agentEmail = (payload.from_agent || "lokzu@ag.waveio.me").toLowerCase().trim();
      const brevoApiKey = env.BREVO_API_KEY;
      const verifiedSender = env.DEFAULT_SENDER_EMAIL || "noreply@waveio.me";

      if (!brevoApiKey) {
        return Response.json({ error: "BREVO_API_KEY secret is not configured in worker" }, { status: 500, headers: corsHeaders });
      }

      // 4. Construct rich HTML if not explicitly provided
      const finalHtml = htmlBody || `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; background: #0f172a; color: #f8fafc; border-radius: 14px; max-width: 600px; margin: 0 auto; border: 1px solid #1e293b;">
          <div style="margin-bottom: 16px; border-bottom: 1px solid #334155; padding-bottom: 12px;">
            <span style="font-size: 12px; color: #38bdf8; font-weight: 600; text-transform: uppercase;">Лист від ШІ-агента • ${agentEmail}</span>
            <h2 style="margin: 8px 0 0 0; color: #ffffff; font-size: 20px;">${subject}</h2>
          </div>
          <div style="font-size: 15px; line-height: 1.6; color: #cbd5e1; white-space: pre-wrap;">${body}</div>
          <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #1e293b; font-size: 12px; color: #64748b;">
            Відправлено агентом <b>${agentName}</b> через шлюз send.waveio.me. Відповісти: <a href="mailto:${agentEmail}" style="color: #38bdf8;">${agentEmail}</a>
          </div>
        </div>
      `.trim();

      // 5. Send via Brevo API
      const brevoPayload = {
        sender: { name: agentName, email: verifiedSender },
        replyTo: { name: agentName, email: agentEmail },
        to: [{ email: to }],
        subject: subject,
        htmlContent: finalHtml,
      };

      try {
        const brevoResp = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": brevoApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(brevoPayload),
        });

        const brevoData = await brevoResp.json();
        if (!brevoResp.ok) {
          return Response.json(
            { error: "Brevo delivery failed", status: brevoResp.status, details: brevoData },
            { status: 502, headers: corsHeaders }
          );
        }

        // Store in sent history in KV
        const sentRecord = {
          message_id: brevoData.messageId,
          agent_email: agentEmail,
          to,
          subject,
          snippet: body.substring(0, 200),
          sent_at: new Date().toISOString(),
        };

        await env.AG_MAILBOX.put(
          `sent:${agentEmail}:${Date.now()}`,
          JSON.stringify(sentRecord),
          { expirationTtl: 60 * 60 * 24 * 30 }
        );

        return Response.json(
          {
            success: true,
            message_id: brevoData.messageId,
            from: agentEmail,
            to,
            subject,
          },
          { headers: corsHeaders }
        );
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });

  },
};
