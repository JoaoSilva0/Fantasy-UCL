"use server";
import { z } from "zod";
import { prisma } from "../db";
import { createSession, destroySession, hashPassword, requireUser, verifyCredentials } from "../auth";
import { run, UserError } from "../errors";

const registerSchema = z.object({
  displayName: z.string().trim().min(2, "Nome demasiado curto.").max(40),
  email: z.string().trim().toLowerCase().email("Email inválido."),
  password: z.string().min(8, "A palavra-passe tem de ter pelo menos 8 caracteres.").max(200),
});

const first = (e: z.ZodError) => e.issues[0]?.message ?? "Dados inválidos.";

export async function register(input: z.input<typeof registerSchema>) {
  return run(async () => {
    const p = registerSchema.safeParse(input);
    if (!p.success) throw new UserError(first(p.error));
    if (await prisma.user.findUnique({ where: { email: p.data.email } })) throw new UserError("Já existe uma conta com este email.");
    const colors = ["#2F6BFF", "#7C5CFF", "#00B8D9", "#3DDC97", "#FF7A8A", "#F5B942"];
    const user = await prisma.user.create({
      data: { email: p.data.email, displayName: p.data.displayName, passwordHash: await hashPassword(p.data.password), avatarColor: colors[Math.floor(Math.random() * colors.length)] },
    });
    await createSession(user.id);
  });
}

export async function login(input: { email: string; password: string }) {
  return run(async () => {
    const user = await verifyCredentials(String(input.email ?? ""), String(input.password ?? ""));
    await createSession(user.id);
  });
}

export async function logout() {
  await destroySession();
}

export async function updateProfile(input: { displayName: string; avatarColor: string }) {
  return run(async () => {
    const u = await requireUser();
    const p = z.object({ displayName: z.string().trim().min(2).max(40), avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).safeParse(input);
    if (!p.success) throw new UserError("Dados inválidos.");
    await prisma.user.update({ where: { id: u.id }, data: p.data });
  });
}

export async function changePassword(input: { current: string; next: string }) {
  return run(async () => {
    const u = await requireUser();
    await verifyCredentials(u.email, input.current);
    if (input.next.length < 8) throw new UserError("A nova palavra-passe tem de ter pelo menos 8 caracteres.");
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(input.next) } });
    await prisma.session.deleteMany({ where: { userId: u.id } });
    await createSession(u.id);
  });
}

export async function markNotificationsRead() {
  const u = await requireUser();
  await prisma.notification.updateMany({ where: { userId: u.id, readAt: null }, data: { readAt: new Date() } });
}
