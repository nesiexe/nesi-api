import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createProxyTrust } from "../../lib/trusted-proxies";
import { env } from "../../lib/env";
import { buildSpotifyAuthUrl, exchangeCodeForRefreshToken } from "./repositories/spotify-auth-repo";
import { SpotifyAuthCallbackQuery } from "./dtos/spotify-auth-dto";

const digest = (value: string) => createHash("sha256").update(value).digest();
const cookieName = "spotify_oauth_state";
const stateTtl = 10 * 60 * 1000;

export default async function spotifyAuthModule(fastify: FastifyInstance) {
  const redirect = new URL(env.SPOTIFY_REDIRECT_URI);
  const loopbackRedirect = ["127.0.0.1", "[::1]"].includes(redirect.hostname);
  if ((redirect.protocol !== "https:" && !(redirect.protocol === "http:" && loopbackRedirect)) ||
      redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== "/api/callback") {
    throw new Error("Spotify redirect must use HTTPS or loopback HTTP and the /api/callback path");
  }
  const pending = new Map<string, { expires: number; verifier: string }>();
  const trusts = createProxyTrust(env.TRUSTED_PROXIES, env.NODE_ENV === "production");
  await fastify.register(import("@fastify/rate-limit"), { max: 30, timeWindow: "1 minute" });
  fastify.addHook("onClose", async () => { pending.clear(); });
  fastify.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    if (!env.SPOTIFY_AUTH_PASSWORD) return reply.code(503).send({ error: "Authorization server disabled" });
    const peer = req.raw.socket.remoteAddress ?? "";
    const hasForwarding = Object.keys(req.headers).some((name) => name === "forwarded" || name.startsWith("x-forwarded-"));
    const directLoopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer) &&
      !trusts(peer, 0) && !hasForwarding;
    if (req.protocol !== "https" && !directLoopback) {
      return reply.code(403).send({ error: "HTTPS or a loopback connection is required" });
    }
    const authorization = req.headers.authorization ?? "";
    let credentials = "";
    if (authorization.startsWith("Basic ") && authorization.length < 2048) {
      credentials = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    }
    if (!timingSafeEqual(digest(credentials), digest(`admin:${env.SPOTIFY_AUTH_PASSWORD}`))) {
      return reply.header("WWW-Authenticate", 'Basic realm="Spotify authorization", charset="UTF-8"')
        .code(401).send({ error: "Authentication required" });
    }
  });

  const cookie = (value: string, maxAge: number) =>
    `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/api/callback; Max-Age=${maxAge}` +
    (redirect.protocol === "https:" ? "; Secure" : "");

  fastify.get("/login", async (_req, reply) => {
    for (const [state, flow] of pending) if (flow.expires <= Date.now()) pending.delete(state);
    if (pending.size >= 100) return reply.code(429).send({ error: "Too many authorization attempts" });
    const state = randomBytes(32).toString("hex");
    const verifier = randomBytes(32).toString("base64url");
    const url = buildSpotifyAuthUrl(state, digest(verifier).toString("base64url"));
    pending.set(state, { expires: Date.now() + stateTtl, verifier });
    reply.header("Set-Cookie", cookie(state, stateTtl / 1000));
    return reply.redirect(url);
  });

  fastify.get("/api/callback", {
    schema: { querystring: SpotifyAuthCallbackQuery },
  }, async (req, reply) => {
    const { code, state } = req.query as z.infer<typeof SpotifyAuthCallbackQuery>;
    const cookies = (req.headers.cookie ?? "").split(";").map((part) => part.trim());
    const matches = cookies.filter((part) => part.startsWith(`${cookieName}=`));
    const suppliedCookie = matches.length === 1 ? matches[0].slice(cookieName.length + 1) : "";
    const flow = pending.get(state);
    if (!flow || flow.expires <= Date.now() || !timingSafeEqual(digest(suppliedCookie), digest(state))) {
      return reply.code(400).send({ error: "Invalid or expired authorization state" });
    }
    // Consume before exchanging the code, including when Spotify fails.
    pending.delete(state);
    reply.header("Set-Cookie", cookie("", 0));
    await exchangeCodeForRefreshToken(code, flow.verifier);
    return { success: true, message: "Refresh token updated. You can close this tab." };
  });
}
