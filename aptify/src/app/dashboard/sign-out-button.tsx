"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  return (
    <Button
      variant="outline"
      onClick={async () => {
        try {
          await createClient().auth.signOut({ scope: "local" });
        } finally {
          router.replace("/");
          router.refresh();
        }
      }}
    >
      Log out
    </Button>
  );
}