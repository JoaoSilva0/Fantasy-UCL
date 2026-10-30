import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/server/auth";
import { Logo } from "@/components/ui/misc";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getUser()) redirect("/dashboard");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8"><Logo size={34} /></Link>
      <div className="card w-full max-w-sm p-6">{children}</div>
    </main>
  );
}
