import { Suspense } from "react";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Criar conta" };
export default function Page() {
  return <Suspense><AuthForm mode="register" /></Suspense>;
}
