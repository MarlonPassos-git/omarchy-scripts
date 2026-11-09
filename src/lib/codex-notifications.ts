import { basename } from "node:path";

export type JsonObject = Record<string, unknown>;
export type NoticeKind = "response" | "progress" | "goal-complete" | "paused" | "blocked" | "budget" | "usage" | "interrupted" | "failed" | "approval" | "input";
export type Notice = { kind: NoticeKind; thread: string; turn?: string; cwd: string; text?: string };
export type NoticeView = { title: string; body: string; urgency: "low" | "normal" | "critical"; action: string };

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function compact(text: string, limit: number): string {
  const normalized = text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim().replace(/\s+/g, " ");
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

export const noticeKinds: NoticeKind[] = ["response", "progress", "goal-complete", "input", "approval", "blocked", "budget", "usage", "interrupted", "paused", "failed"];

const presentation: Record<NoticeKind, [string, NoticeView["urgency"], string, string]> = {
  response: ["Resposta pronta", "normal", "Ver resposta", "A resposta está pronta para revisão."],
  progress: ["Meta em andamento", "low", "Acompanhar", "Etapa concluída. O Codex continua trabalhando na meta."],
  "goal-complete": ["Meta concluída", "normal", "Ver resultado", "O Codex concluiu a meta. Confira o resultado na sessão."],
  input: ["Precisa de você", "normal", "Responder", "O Codex aguarda sua resposta para continuar."],
  approval: ["Aprovação pendente", "normal", "Revisar no Codex", "Revise a ação e as permissões na sessão do Codex."],
  blocked: ["Meta bloqueada", "normal", "Ver motivo", "A meta precisa de uma decisão ou mudança externa para continuar."],
  budget: ["Limite da meta atingido", "normal", "Rever limite", "O limite de tokens da meta foi atingido. O trabalho ficou incompleto."],
  usage: ["Limite de uso atingido", "normal", "Ver limite", "O Codex parou por um limite de uso. Confira a disponibilidade na sessão."],
  interrupted: ["Interrompido", "low", "Abrir sessão", "O turno foi interrompido. O trabalho pode estar incompleto."],
  paused: ["Meta pausada", "low", "Abrir sessão", "A meta está pausada. Você pode retomá-la pelo /goal na sessão."],
  failed: ["Falha na execução", "critical", "Ver erro", "A execução falhou. Confira o erro e o trabalho parcial na sessão."],
};

export function noticeView(notice: Notice): NoticeView {
  const [label, urgency, action, fallback] = presentation[notice.kind];
  const project = compact(basename(notice.cwd), 60);
  const raw = notice.text || fallback;
  const body = notice.kind === "input" ? raw.split(/\r?\n/).slice(0, 4).map((line) => compact(line, 240)).join("\n").slice(0, 500) : compact(raw, 240);
  return { title: `${label}${project ? ` · ${project}` : ""}`, body, urgency, action };
}

export function goalKind(status: unknown): NoticeKind | undefined {
  switch (status) {
    case "complete": return "goal-complete";
    case "paused": return "paused";
    case "blocked": return "blocked";
    case "budgetLimited": return "budget";
    case "usageLimited": return "usage";
    default: return undefined;
  }
}

/** Questions remain in Codex: notification buttons only navigate, never submit consent. */
export function questionText(params: JsonObject): string | undefined {
  const questions = Array.isArray(params.questions) ? params.questions : [];
  const first = questions.find(isObject);
  if (!first) return undefined;
  const question = typeof first.question === "string" ? first.question : typeof first.title === "string" ? first.title : "";
  const options = Array.isArray(first.options) ? first.options : [];
  const labels = options.slice(0, 3).flatMap((option) => typeof option === "string" ? [option] : isObject(option) && typeof option.label === "string" ? [option.label] : []);
  return [compact(question, 240), ...labels.map((label, index) => `${index + 1}. ${compact(label, 65)}`)].filter(Boolean).join("\n");
}
