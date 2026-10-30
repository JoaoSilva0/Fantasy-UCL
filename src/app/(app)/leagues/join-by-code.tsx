"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) router.push(`/join/${code.trim().toUpperCase()}`); }} className="flex gap-2">
      <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="EX: K7QM2XPA" maxLength={8} className="font-mono tracking-widest" aria-label="Código de convite" />
      <Button disabled={code.trim().length < 8}>Ver</Button>
    </form>
  );
}
