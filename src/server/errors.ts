/** Erro de regra de negócio: a mensagem é segura para mostrar ao utilizador. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Envolve uma server action: erros de negócio viram `{ ok: false, error }`; os restantes são registados. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002")
      return { ok: false, error: "Operação em conflito com outra (ex: jogador já escolhido). Tenta novamente." };
    // Redirects/notFound do Next têm de propagar.
    if (e && typeof e === "object" && "digest" in e) throw e;
    console.error(e);
    return { ok: false, error: "Ocorreu um erro inesperado." };
  }
}
