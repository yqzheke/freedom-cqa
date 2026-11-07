import { retryRun } from "../../../lib/diagnostics";
import { mediaResponse } from "../../../lib/media";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { state, change, hash } from "../../../lib/store";
import {
  rubric,
  envelope,
  normalized,
  finding,
  calculate,
} from "../../../lib/domain";
import { evaluate, audioBytes } from "../../../lib/provider";
export const runtime = "nodejs",
  maxDuration = 240,
  dynamic = "force-dynamic";
function local(req: NextRequest) {
  return (
    !process.env.VERCEL &&
    !process.env.DEMO_ACCESS_TOKEN &&
    ["localhost", "127.0.0.1", "[::1]"].includes(req.nextUrl.hostname) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(
      (req.headers.get("host") ?? "").replace(/:\d+$/, ""),
    )
  );
}
function signature(n: string) {
  return createHmac("sha256", process.env.DEMO_ACCESS_TOKEN!)
    .update(n)
    .digest("hex");
}
function access(req: NextRequest) {
  if (local(req)) return true;
  const [n, s] = (req.cookies.get("cqa")?.value ?? "").split(".");
  return (
    !!process.env.DEMO_ACCESS_TOKEN &&
    Number(n) > Date.now() &&
    s === signature(n)
  );
}
const error = (message: string, status = 400) =>
  NextResponse.json({ message }, { status });
export async function GET(req: NextRequest) {
  if (!access(req)) return error("Требуется ссылка доступа", 403);
  const s = await state();
  const audio = req.nextUrl.searchParams.get("audio");
  if (audio) {
    try {
      const d = s.docs.find((x) => x.id === audio);
      if (!d?.data.audio_url) return error("Запись отсутствует", 404);
      const bytes = await audioBytes(d.data.audio_url);
      return mediaResponse(bytes, req.headers.get("range"));
    } catch {
      return error("Запись недоступна", 502);
    }
  }
  return NextResponse.json(
    {
      ...s,
      imports: undefined,
      docs: s.docs.map((d) => ({
        ...d,
        data: { ...d.data, audio_url: d.data.audio_url ? "available" : null },
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: NextRequest) {
  if (
    req.headers.get("origin") !==
    req.nextUrl.protocol + "//" + req.headers.get("host")
  )
    return error("Недопустимый источник", 403);
  try {
    const raw = await req.text();
    if (raw.length > 3500000) return error("Слишком большой запрос", 413);
    const b = JSON.parse(raw);
    if (b.op === "access") {
      const key = process.env.DEMO_ACCESS_TOKEN;
      if (
        !key ||
        typeof b.token !== "string" ||
        !timingSafeEqual(Buffer.from(hash(key)), Buffer.from(hash(b.token)))
      )
        return error("Неверная ссылка", 403);
      const n = String(Date.now() + 8 * 3600000);
      const res = NextResponse.json({ ok: true });
      res.cookies.set("cqa", n + "." + signature(n), {
        httpOnly: true,
        secure: req.nextUrl.protocol === "https:",
        sameSite: "strict",
        path: "/",
        maxAge: 28800,
      });
      return res;
    }
    if (!access(req)) return error("Требуется ссылка доступа", 403);
    if (b.op === "import") {
      let payload = b.payload;
      if (!payload) {
        const group = z
          .string()
          .regex(/^[\w-]{1,80}$/)
          .parse(b.group);
        const url = new URL(process.env.ORGANIZER_API_BASE_URL!);
        if (url.protocol !== "https:" || isIP(url.hostname))
          throw Error("Настройте адрес API");
        url.searchParams.set("group_id", group);
        const response = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(25000),
          cache: "no-store",
        });
        if (!response.ok) throw Error("Организатор не вернул набор");
        payload = await response.json();
        if (payload?.data?.dataset_group_id !== group)
          throw Error("Неверная группа");
      }
      const { data } = envelope.parse(payload);
      await change((s) => {
        for (const d of data.records) {
          const id = hash([data.dataset_group_id, d]);
          if (!s.docs.some((x) => x.id === id))
            s.docs.push({ id, group: data.dataset_group_id, data: d });
        }
        const digest = hash(payload);
        if (!s.imports.some((i) => i.hash === digest))
          s.imports.push({
            group: data.dataset_group_id,
            hash: digest,
            raw: payload,
          });
      });
    } else if (b.op === "publish") {
      const r = rubric.parse(b.r);
      await change((s) => {
        const id = hash(r);
        if (!s.versions.some((v) => v.id === id)) s.versions.push({ id, r });
      });
    } else if (b.op === "start") {
      await change((s) => {
        if (
          !s.docs.some((x) => x.id === b.doc) ||
          !s.versions.some((x) => x.id === b.version)
        )
          throw Error("Версия недоступна");
        const key = hash([
          b.doc,
          b.version,
          process.env.GEMINI_TEXT_MODEL,
          process.env.GEMINI_AUDIO_MODEL,
          "v1",
        ]);
        if (!s.runs.some((x) => x.key === key))
          s.runs.push({
            key,
            id: crypto.randomUUID(),
            doc: b.doc,
            version: b.version,
            status: "queued",
            token: "",
            lease: 0,
            created: new Date().toISOString(),
            original: [],
            current: [],
            cancel: false,
            error: "",
          });
      });
    } else if (b.op === "resumeQueue") {
      await change((s) => {
        delete s.queuePause;
      });
    } else if (b.op === "step") {
      const claim = await change((s) => {
        const r = s.runs.find((x) => x.id === b.id);
        if (!r || s.queuePause) return null;
        if (r.status === "running" && r.lease < Date.now()) {
          r.status = r.cancel ? "cancelled" : "failed";
          r.error = "Истекло время обработки. Проверьте расходы перед повтором";
          r.token = "";
          return null;
        }
        if (
          r.status !== "queued" ||
          s.runs.some((x) => x.status === "running" && x.lease > Date.now())
        )
          return null;
        r.status = "running";
        r.token = crypto.randomUUID();
        r.lease = Date.now() + 240000;
        return {
          token: r.token,
          d: s.docs.find((x) => x.id === r.doc)!.data,
          version: s.versions.find((x) => x.id === r.version)!.r,
        };
      });
      if (claim) {
        try {
          const rows = await evaluate(
            b.id,
            claim.d,
            claim.version,
            claim.token,
          );
          await change((s) => {
            const r = s.runs.find((x) => x.id === b.id)!;
            if (r.token !== claim.token) return;
            r.original = rows;
            r.current = structuredClone(rows);
            r.status = r.cancel ? "cancelled" : "completed";
          });
        } catch (e) {
          await change((s) => {
            const r = s.runs.find((x) => x.id === b.id)!;
            if (r.token === claim.token) {
              r.status = r.cancel ? "cancelled" : "failed";
              if (s.queuePause && !r.cancel) r.status = "queued";
              r.error = s.queuePause ?? safe(e);
            }
          });
        }
      }
    } else if (b.op === "retry" || b.op === "cancel") {
      await change((s) => {
        const r = s.runs.find((x) => x.id === b.id)!;
        if (b.op === "retry") retryRun(r, b.attempt);
        if (b.op === "cancel") {
          r.cancel = true;
          if (r.status === "queued") r.status = "cancelled";
        }
      });
    } else if (b.op === "appeal") {
      const comment = z.string().trim().min(1).max(4000).parse(b.comment);
      await change((s) => {
        const r = s.runs.find((x) => x.id === b.run);
        if (!r?.current.some((x) => x.id === b.criterion))
          throw Error("Оценка недоступна");
        if (
          s.appeals.some(
            (x) => x.run === r.id && x.criterion === b.criterion && !x.action,
          )
        )
          throw Error("Апелляция уже открыта");
        s.appeals.push({
          id: crypto.randomUUID(),
          run: r.id,
          criterion: b.criterion,
          comment,
          reason: "",
          action: "",
          revision: s.appeals.filter((x) => x.run === r.id && x.action).length,
        });
      });
    } else if (b.op === "decide") {
      const reason = z.string().trim().min(1).max(4000).parse(b.reason);
      await change((s) => {
        const a = s.appeals.find((x) => x.id === b.id)!;
        if (
          a.action ||
          b.revision !==
            s.appeals.filter((x) => x.run === a.run && x.action).length
        )
          throw Error("Конфликт решения");
        const r = s.runs.find((x) => x.id === a.run)!,
          v = s.versions.find((x) => x.id === r.version)!.r,
          i = r.current.findIndex((x) => x.id === a.criterion);
        a.previous = structuredClone(r.current[i]);
        a.action = z.enum(["uphold", "replace"]).parse(b.action);
        a.reason = reason;
        if (a.action === "replace") {
          const f = finding.parse({
            ...r.current[i],
            ...b.answer,
            id: a.criterion,
            reason,
            evidence: r.current[i].evidence,
          });
          normalized(
            v.criteria.find((c) => c.id === a.criterion)!,
            f,
          );
          r.current[i] = f;
          a.replacement = f;
        }
        calculate(v, r.current);
      });
    } else return error("Неизвестное действие");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return error(
      safe(e),
      e instanceof Error && e.message.startsWith("Конфликт") ? 409 : 400,
    );
  }
}
function safe(e: unknown) {
  return e instanceof z.ZodError
    ? "Проверьте поля: " +
        e.issues
          .map((i) => i.path.join("."))
          .slice(0, 5)
          .join(", ")
    : e instanceof Error && /^[А-ЯЁ]/.test(e.message)
      ? e.message
      : "Ошибка обработки. Проверьте формат и настройки сервера";
}
