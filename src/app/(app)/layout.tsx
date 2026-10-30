import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { TopBar } from "@/components/app/top-bar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const notifications = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 });
  return (
    <div className="min-h-dvh">
      <TopBar user={user} notifications={notifications.map((n) => ({ ...n, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null }))} />
      {children}
    </div>
  );
}
